<p align="center">
  <img src="https://raw.githubusercontent.com/apostl-dev/pulse-sdk/main/docs/pulse-readme.svg" alt="Apostl Pulse — live AI agent traffic signal" width="100%" />
</p>

# Apostl Pulse SDK

Estimate AI agent visits and see which public website, docs, or API pages they use.

Pulse works as a middleware to track any agent-first endpoint:
- Markdown-supported pages
- llms.txt and llms-full.txt
- API endpoints for agents
- app routes for agents

Pulse groups requests with the same project, trusted IP, and full User-Agent into one journey until a 30-minute inactivity window expires. Installations and origins connected to the same project stay in that journey.

An exact `llms.txt` visit is immediate evidence. A generic non-browser client such as `curl` is also counted when it visits two distinct machine-readable surfaces within ten minutes—for example `openapi.json` and a Markdown page. This catches real tool-driven research even when the client does not announce an agent name.

## One-line Install

```sh
npm install @apostl-dev/pulse-sdk
```

MIT-licensed [source code is on GitHub](https://github.com/apostl-dev/pulse-sdk).

### Node

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
});
```

* Pulse SDK sends the trusted client IP and User-Agent data to [Apostl website](https://apostl.dev).
* It records the canonical origin and path only. Query parameters, fragments, request bodies, cookies, and authorization headers are not sent.
* Public health and API GET/HEAD requests are included; auth/account routes, assets, mutations, and 5xx responses are excluded.
* Use `cf-connecting-ip` when your deployment trusts Cloudflare.
* Keep `APOSTL_PULSE_API_KEY` in the server runtime; never expose it through browser bundles or public environment variables.

### Express

```ts
import { pulseExpressMiddleware } from '@apostl-dev/pulse-sdk/express';

app.use(pulseExpressMiddleware(pulse));
```

### Next.js

```ts
import { withPulse } from '@apostl-dev/pulse-sdk/next';

export const GET = withPulse(pulse, async () => new Response(renderDocs(), {
  headers: { 'content-type': 'text/html' },
}));
```

## Setup for AI agents

Install the public setup skill:

```sh
npx skills add apostl-dev/apostl-skills --skill agent-traffic-analytics -g -y
```

Then ask your agent to connect the exact public HTTPS origin where it is authorized to deploy the server middleware. The skill stores the one-time API key and setup token in an owner-only file instead of printing them.

`example.com` and similar names are reserved documentation domains, not end-to-end demo targets. Pulse rejects them before issuing credentials. Use a real origin you can deploy, or stop and obtain one from the owner.

Example task:

```text
Use $agent-traffic-analytics to connect my authorized public docs origin and verify a real visit to /llms.txt.
```

The unclaimed setup lasts seven days. A claim URL appears only after the signed public response and the matching genuine event both pass. The owner then signs in with Google, GitHub, or an email magic link; the ingest API key remains active after claim.

Read the [full agent setup guide](https://apostl.dev/pulse.md) or the exact [OpenAPI contract](https://apostl.dev/openapi.json).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No events | Confirm the server has the API key and ingest endpoint, and that requests include a trusted client IP and full User-Agent. |
| Verification is waiting | Deploy the adapter on the public HTTPS origin and keep the selected verification path reachable, then retry the same `verify_url`. |
| IP addresses are the same | Check your trusted proxy setup (Cloudflare, nginx, etc) |
| Final events are missing | Call `await pulse.flush()` during graceful shutdown. |
| Need local state | `diagnostics()` returns bounded counters without credentials or captured request data. |

## Support

For setup help, message [@SwiftAdviser](https://t.me/SwiftAdviser) on Telegram.
