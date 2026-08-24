# Apostl Pulse SDK

Privacy-safe, server-side measurement for one question: **how many AI agents are using your product right now?**

Pulse classifies request headers locally, turns coarse network context into an hourly HMAC session identifier, and sends only allow-listed aggregate-safe fields. Raw URLs, paths, queries, request bodies, cookies, authorization headers, IP addresses, and User-Agent strings never leave your server.

## Install

```sh
npm install @apostldev/pulse-sdk
```

## Fetch / Node

```ts
import { createPulse } from '@apostldev/pulse-sdk';

const pulse = createPulse({
  endpoint: 'https://ingest.apostl.dev',
  writeKey: process.env.APOSTL_PULSE_WRITE_KEY,
  identitySecret: process.env.APOSTL_PULSE_IDENTITY_SECRET,
  service: 'docs',
  environment: 'production',
});

pulse.observeRequest({
  method: request.method,
  statusCode: response.statusCode,
  headers: request.headers,
  ip: request.headers['cf-connecting-ip'],
  surface: 'markdown',
  surfaceName: 'quickstart',
});
```

Call `await pulse.flush()` during graceful shutdown. `diagnostics()` exposes bounded counters and never exposes credentials or captured request values.

## Express

```ts
import { pulseExpressMiddleware } from '@apostldev/pulse-sdk/express';

app.use(pulseExpressMiddleware(pulse, () => ({ surface: 'html', surfaceName: 'docs' })));
```

## Next.js

```ts
import { withPulse } from '@apostldev/pulse-sdk/next';

export const GET = withPulse(pulse, async () => Response.json({ ok: true }), () => ({
  surface: 'api',
  surfaceName: 'status',
}));
```

## Operational limits

- Node.js 20 or newer
- 50 events or 256 KiB per batch; 16 KiB per event
- 500-event bounded in-memory queue
- one-second delivery timeout
- up to three attempts only for HTTP `429` and `5xx`
- no persistence and no impact on the host response path
