<p align="center">
  <img src="https://raw.githubusercontent.com/apostl-dev/pulse-sdk/main/docs/pulse-readme.svg" alt="Apostl Pulse — live AI agent traffic signal" width="100%" />
</p>

# Apostl Pulse SDK

Server-side measurement for one question: **how many AI agents are using your product right now?**

Pulse sends the request IP address and full User-Agent to your configured ingest endpoint. Ingest uses them for centrally managed agent classification, while the SDK derives an hourly session identifier with your server-only API key. Raw URLs, paths, queries, request bodies, cookies, and authorization headers are never included in Pulse events. The API key is used only as the HTTPS bearer credential and local HMAC key; it is never included in the event payload.

## Install

```sh
npm install @apostl-dev/pulse-sdk
```

The package is also available as complete [MIT-licensed source](https://github.com/apostl-dev/pulse-sdk).

## Fetch / Node

```ts
import { createPulse } from '@apostl-dev/pulse-sdk';

const pulse = createPulse({
  endpoint: 'https://ingest.apostl.dev',
  apiKey: process.env.APOSTL_PULSE_API_KEY,
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

Set the key only in your server runtime:

```sh
APOSTL_PULSE_API_KEY=pulse_api_...
```

Do not expose it through browser bundles or public environment variables. Existing `writeKey` and `APOSTL_PULSE_WRITE_KEY` configurations remain supported as deprecated migration aliases.

`service` is intentionally not part of the SDK interface. Name and segment each installation in your analytics workspace. Because IP addresses and User-Agent strings are transmitted, disclose the collection and choose an appropriate retention policy for your jurisdiction.

Call `await pulse.flush()` during graceful shutdown. `diagnostics()` exposes bounded counters and never exposes credentials or captured request values.

## Express

```ts
import { pulseExpressMiddleware } from '@apostl-dev/pulse-sdk/express';

app.use(pulseExpressMiddleware(pulse, () => ({ surface: 'html', surfaceName: 'docs' })));
```

## Next.js

```ts
import { withPulse } from '@apostl-dev/pulse-sdk/next';

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
