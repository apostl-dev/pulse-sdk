import {
  PULSE_VERIFICATION_PAGE_HEADER,
  PULSE_VERIFICATION_PROOF_HEADER,
  type ObserveRequestInput,
  type PulseClient,
  type PulseSurface,
} from './index.js';

interface ExpressRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  originalUrl?: string;
  url?: string;
}

interface ExpressResponseLike {
  statusCode?: number;
  setHeader?(name: string, value: string): unknown;
  once?(event: 'finish', listener: () => void): unknown;
  on?(event: 'finish', listener: () => void): unknown;
}

export function pulseExpressMiddleware(
  pulse: PulseClient,
  select: (request: ExpressRequestLike) => { surface: PulseSurface; surfaceName: string; eligible?: boolean } = () => ({ surface: 'other', surfaceName: 'other' }),
) {
  return (request: ExpressRequestLike, response: ExpressResponseLike, next: () => void): void => {
    const startedAt = performance.now();
    const requestUrl = request.originalUrl ?? request.url;
    const verification = pulse.verificationResponse({ headers: request.headers, url: requestUrl });
    if (verification && response.setHeader) {
      response.setHeader(PULSE_VERIFICATION_PAGE_HEADER, verification.pageUrl);
      response.setHeader(PULSE_VERIFICATION_PROOF_HEADER, verification.proof);
    }
    const observe = (): void => {
      const selection = select(request);
      const input: ObserveRequestInput = {
        method: request.method,
        statusCode: response.statusCode,
        headers: request.headers,
        ip: request.ip,
        url: requestUrl,
        durationMs: Math.round(performance.now() - startedAt),
        ...selection,
      };
      pulse.observeRequest(input);
    };
    if (response.once) response.once('finish', observe);
    else response.on?.('finish', observe);
    next();
  };
}
