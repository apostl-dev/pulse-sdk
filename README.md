<p align="center">
  <img src="https://raw.githubusercontent.com/apostl-dev/pulse-sdk/main/docs/pulse-readme.svg" alt="Apostl Pulse — live AI agent traffic signal" width="100%" />
</p>

# Apostl Pulse SDK

Server-side measurement: **how many AI agents are using your product right now?**

Pulse sends request IP, full User-Agent, and canonical page identity (`origin + pathname`) to your ingest endpoint, excluding queries, fragments, URL credentials, bodies, cookies, and authorization headers. Ingest classifies agents. The SDK locally derives an hourly session identifier with your server-only API key, used only as the HTTPS bearer credential and local HMAC key, never included in the payload.

## Install

```sh
npm install @apostl-dev/pulse-sdk
```

The [source](https://github.com/apostl-dev/pulse-sdk) is MIT-licensed.

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
  url: request.url,
  surface: 'markdown',
  surfaceName: 'quickstart',
});
```

Pulse counts public `GET` and `HEAD` responses with `2xx` through `4xx` statuses. The SDK and ingest exclude common assets, health checks, auth/private paths, and mutations; no eligibility or service-type configuration is needed.

Keep the key in your server runtime:

```sh
APOSTL_PULSE_API_KEY=pulse_api_...
```

Never expose it through browser bundles or public environment variables. Deprecated `writeKey` and `APOSTL_PULSE_WRITE_KEY` aliases still work.

`service` is not an SDK option; name and segment installations in your analytics workspace. Pulse sends IP addresses and User-Agent strings, so disclose collection and set a jurisdiction-appropriate retention policy.

On graceful shutdown, call `await pulse.flush()`. `diagnostics()` returns bounded counters without credentials or captured request data.

## Express

```ts
import { pulseExpressMiddleware } from '@apostl-dev/pulse-sdk/express';

app.use(pulseExpressMiddleware(pulse));
```

## Next.js

```ts
import { withPulse } from '@apostl-dev/pulse-sdk/next';

export const GET = withPulse(pulse, async () => new Response(renderDocs(), {
  headers: { 'content-type': 'text/html' },
}));
```

Both adapters answer Apostl's signed deployment challenge and observe its public request. Verification requires that response and its real event.

## Start before creating an account

```sh
curl -X POST https://platform.apostl.dev/api/v1/pulse/setups \
  -H 'content-type: application/json' \
  -d '{"origin":"https://docs.example.com","verification_path":"/llms.txt","project_name":"Example docs","agent_name":"Codex"}'
```

The response reveals the API key, an opaque setup token, and `verify_url` once. Deploy the middleware, then poll `verify_url` with `Authorization: Bearer <setup_token>` until its signed fetch and event pass. The API then returns a one-time human claim URL. Unclaimed setups expire after seven days; connected origins are rejected.

## Operational limits

- Node.js 20 or newer
- 50 events or 256 KiB per batch; 16 KiB per event
- 500-event bounded in-memory queue
- one-second delivery timeout
- up to three attempts only for HTTP `429` and `5xx`
- no persistence and no impact on the host response path
