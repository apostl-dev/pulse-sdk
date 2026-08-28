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

Before you instrument a site, use the [AI Agent Analytics guide](https://apostl.dev/blog/ai-agent-analytics) to separate request volume, page demand, task outcomes, and the limits of agent identity.

## One-line Install

```sh
npm install @apostl-dev/pulse-sdk
```

You need an API key. There are two options:
- Approach for AI agents: [Ask your AI agent](https://github.com/apostl-dev/pulse-sdk#setup-for-ai-agents) to get an API key.
- Approach for humans: Register using Google or Github on [Apostl.dev](https://platform.apostl.dev/?utm_source=github) and get API key by yourself.

## Copy-paste quickstarts

Set `APOSTL_PULSE_ENDPOINT=https://ingest.apostl.dev` and
`APOSTL_PULSE_API_KEY` in the server runtime. `createPulse()` reads both by
default. Never expose the API key through client bundles, `NEXT_PUBLIC_*`, HTML,
logs, or a public diagnostics response.

### Node HTTP server

```ts
import { createServer } from 'node:http';
import { createPulse } from '@apostl-dev/pulse-sdk';

const pulse = createPulse();
const server = createServer((request, response) => {
  const startedAt = performance.now();
  response.once('finish', () => {
    const cloudflareIp = request.headers['cf-connecting-ip'];
    pulse.observeRequest({
      method: request.method,
      statusCode: response.statusCode,
      headers: request.headers,
      // Trust this header only when the origin accepts traffic through Cloudflare.
      ip: typeof cloudflareIp === 'string' ? cloudflareIp : request.socket.remoteAddress,
      url: request.url,
      durationMs: Math.round(performance.now() - startedAt),
      surface: request.url?.startsWith('/llms.txt') ? 'llms' : 'other',
      surfaceName: request.url?.startsWith('/llms.txt') ? 'llms-index' : 'other',
    });
  });

  if (request.url?.startsWith('/llms.txt')) {
    response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
    response.end('# Agent docs\n');
    return;
  }
  response.writeHead(404).end();
});

server.listen(Number(process.env.PORT ?? 3000));
process.on('SIGTERM', () => server.close(async () => {
  await pulse.close();
  process.exit(0);
}));
```

### Express

```ts
import express from 'express';
import { createPulse } from '@apostl-dev/pulse-sdk';
import { pulseExpressMiddleware } from '@apostl-dev/pulse-sdk/express';

const pulse = createPulse();
const app = express();

// Configure Express `trust proxy` only for the proxy/CDN you actually control.
app.use(pulseExpressMiddleware(pulse, (request) => {
  const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
  return path === '/llms.txt'
    ? { surface: 'llms', surfaceName: 'llms-index' }
    : { surface: 'other', surfaceName: 'other' };
}));

app.get('/llms.txt', (_request, response) => {
  response.type('text/markdown').send('# Agent docs\n');
});

const server = app.listen(Number(process.env.PORT ?? 3000));
process.on('SIGTERM', () => server.close(async () => {
  await pulse.close();
  process.exit(0);
}));
```

* Pulse SDK sends the trusted client IP and User-Agent data to [Apostl website](https://apostl.dev).
* It records the canonical origin and path only. Query parameters, fragments, request bodies, cookies, and authorization headers are not sent.
* Public health and API GET/HEAD requests are included; auth/account routes, assets, mutations, and 5xx responses are excluded.
* `/api/mcp` and `/api/turnstile-config` are safe defaults. Other `/api/*` routes are ignored unless their public prefix is listed in `publicApiPrefixes`.
* Use `cf-connecting-ip` when your deployment trusts Cloudflare.
* Keep `APOSTL_PULSE_API_KEY` in the server runtime; never expose it through browser bundles or public environment variables.

### Next.js App Router

Create the server-only client in `lib/pulse.ts`:

```ts
import 'server-only';
import { createPulse } from '@apostl-dev/pulse-sdk';

export const pulse = createPulse();
```

Wrap the real Route Handler in `app/llms.txt/route.ts`:

```ts
import { withPulse } from '@apostl-dev/pulse-sdk/next';
import { pulse } from '../../lib/pulse';

export const GET = withPulse(
  pulse,
  async () => new Response('# Agent docs\n', {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  }),
  () => ({ surface: 'llms', surfaceName: 'llms-index' }),
);
```

For a one-off test, a temporary protected diagnostics route may call
`await pulse.flush()` and return `pulse.diagnostics()`. Remove or disable that
route after validation; the counters are credential-free, but the endpoint is
operational metadata and should not become a permanent public API.

### Prove the first event

1. Start the production build with both server environment variables present.
2. Request the real public `/llms.txt` route with the deployment's trusted
   client-IP header and a full User-Agent.
3. Flush once from a private test hook or graceful shutdown.
4. Check `pulse.diagnostics()`: `configured=true`, `accepted>=1`, `sent>=1`,
   `droppedDelivery=0`, and `lastError=null`.

`diagnostics()` returns counters only. It never returns the API key, captured
headers, IP addresses, or request URLs.

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

## License

MIT-licensed [source code is on GitHub](https://github.com/apostl-dev/pulse-sdk).