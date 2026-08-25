<p align="center">
  <img src="https://raw.githubusercontent.com/apostl-dev/pulse-sdk/main/docs/pulse-readme.svg" alt="Apostl Pulse — live AI agent traffic signal" width="100%" />
</p>

# Apostl Pulse SDK

See estimated AI-agent visits and the public pages they use. Learn whether agents are finding your docs, APIs, and machine-readable surfaces.

Pulse filters out assets, health/auth/private routes, and mutations. Counts are heuristic estimates, not identity proof.

## Install

```sh
npm install @apostl-dev/pulse-sdk
```

MIT-licensed [source code is on GitHub](https://github.com/apostl-dev/pulse-sdk).

## Node

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
  ip: clientIp, // resolve this from your trusted server or proxy
  url: request.url,
  surface: 'markdown',
  surfaceName: 'quickstart',
});
```

Pulse sends the trusted client IP and full User-Agent, but never bodies, cookies, or authorization headers. For example, use `cf-connecting-ip` only when your deployment trusts Cloudflare. Keep `APOSTL_PULSE_API_KEY` in the server runtime; never expose it through browser bundles or public environment variables.

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

## Setup for AI agents

An AI agent can create an unclaimed setup in one call:

```sh
curl -X POST https://platform.apostl.dev/api/v1/pulse/setups \
  -H 'content-type: application/json' \
  -d '{"origin":"https://docs.example.com","verification_path":"/llms.txt","project_name":"Example docs","agent_name":"Codex"}'
```

The response reveals the credentials and `verify_url` once. Deploy an adapter, then poll `verify_url` with `Authorization: Bearer <setup_token>` to verify a real event and receive the one-time human claim URL. Unclaimed setups expire after seven days, and already-connected origins are rejected.

For a guided first-site setup, use the [Agent Traffic Analytics skill](https://github.com/apostl-dev/apostl-skills/tree/main/skills/agent-traffic-analytics):

```sh
npx skills add apostl-dev/apostl-skills --skill agent-traffic-analytics -g -y
```

Then ask your agent:

```text
Use $agent-traffic-analytics to connect https://docs.example.com and verify a real visit to /llms.txt.
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No events | Confirm the server has the API key and ingest endpoint, and that requests include a trusted client IP and full User-Agent. |
| Verification is waiting | Deploy the adapter on the public HTTPS origin and keep the selected verification path reachable, then retry the same `verify_url`. |
| Final events are missing | Call `await pulse.flush()` during graceful shutdown. |
| Need local state | `diagnostics()` returns bounded counters without credentials or captured request data. |

## Support

For setup help, message [@SwiftAdviser](https://t.me/SwiftAdviser) on Telegram.
