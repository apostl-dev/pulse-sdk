import type { PulseClient, PulseSurface } from './index.js';

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
    return response;
  };
}
