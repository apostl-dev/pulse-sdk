import type { ObserveRequestInput, PulseClient, PulseSurface } from './index.js';

interface ExpressRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  originalUrl?: string;
  url?: string;
}

interface ExpressResponseLike {
  statusCode?: number;
  once?(event: 'finish', listener: () => void): unknown;
  on?(event: 'finish', listener: () => void): unknown;
}

export function pulseExpressMiddleware(
  pulse: PulseClient,
  select: (request: ExpressRequestLike) => { surface: PulseSurface; surfaceName: string; eligible?: boolean } = () => ({ surface: 'other', surfaceName: 'other' }),
) {
  return (request: ExpressRequestLike, response: ExpressResponseLike, next: () => void): void => {
    const startedAt = performance.now();
    const observe = (): void => {
      const selection = select(request);
      const input: ObserveRequestInput = {
        method: request.method,
        statusCode: response.statusCode,
        headers: request.headers,
        ip: request.ip,
        url: request.originalUrl ?? request.url,
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
