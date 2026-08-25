import {
  PULSE_VERIFICATION_PAGE_HEADER,
  PULSE_VERIFICATION_PROOF_HEADER,
  type PulseClient,
  type PulseSurface,
} from './index.js';

type NextHandler<Args extends unknown[]> = (request: Request, ...args: Args) => Response | Promise<Response>;

export function withPulse<Args extends unknown[]>(
  pulse: PulseClient,
  handler: NextHandler<Args>,
  select: (request: Request) => { surface: PulseSurface; surfaceName: string; eligible?: boolean } = () => ({ surface: 'other', surfaceName: 'other' }),
): NextHandler<Args> {
  return async (request, ...args) => {
    const startedAt = performance.now();
    const response = await handler(request, ...args);
    pulse.observeRequest({
      method: request.method,
      statusCode: response.status,
      headers: request.headers,
      ip: request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? undefined,
      url: request.url,
      durationMs: Math.round(performance.now() - startedAt),
      ...select(request),
    });
    const verification = pulse.verificationResponse({ headers: request.headers, url: request.url });
    if (!verification) return response;
    try {
      response.headers.set(PULSE_VERIFICATION_PAGE_HEADER, verification.pageUrl);
      response.headers.set(PULSE_VERIFICATION_PROOF_HEADER, verification.proof);
      return response;
    } catch {
      const headers = new Headers(response.headers);
      headers.set(PULSE_VERIFICATION_PAGE_HEADER, verification.pageUrl);
      headers.set(PULSE_VERIFICATION_PROOF_HEADER, verification.proof);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  };
}
