<p align="center">
  <img src="https://raw.githubusercontent.com/apostl-dev/pulse-sdk/main/docs/pulse-readme.svg" alt="Apostl Pulse — live AI agent traffic signal" width="100%" />
</p>

# Apostl Pulse SDK

Understand AI agents visiting your website and turn them into your new power users.

Pulse SDK is best-in-class solution to track agent activity. It works as a middleware to track agent-first endpoints and turn them into one funnel:
- Markdown-supported pages
- llms.txt and llms-full.txt
- API endpoints for agents (MCP, x402, MPP)
- app routes for built agents

## One-line Install

Give this copy-paste instruction to your AI agent:

```sh
Install the Apostl Agent Traffic Analytics skill and use it to connect this repo and domain to Apostl Pulse.

npx skills add apostl-dev/apostl-skills --skill agent-traffic-analytics -g -y

Create an accountless setup, install the correct server adapter, deploy it, verify a real public request, and return the one-time claim link. Keep the API key and setup token out of source control, browser code, logs, and chat output.

All SDK-related info stored in this repository: https://github.com/apostl-dev/pulse-sdk
```


You need an API key. Your agent will register and get it for you. If you prefer an old-school way just sign up [here](https://platform.apostl.dev).

## Copy-paste quickstarts

Set `APOSTL_PULSE_ENDPOINT=https://ingest.apostl.dev` and
`APOSTL_PULSE_API_KEY` in the server runtime. `createPulse()` reads both by
default. Never expose the API key through client bundles, `NEXT_PUBLIC_*`, HTML,
logs, or a public diagnostics response.

Install SDK first:

```sh
npm i @apostl-dev/pulse-sdk
```



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

## Prove the first event

1. Start the production build with both server environment variables present.
2. Request the real public `/llms.txt` route with the deployment's trusted
   client-IP header and a full User-Agent.
3. Flush once from a private test hook or graceful shutdown.
4. Check `pulse.diagnostics()`: `configured=true`, `accepted>=1`, `sent>=1`,
   `droppedDelivery=0`, and `lastError=null`.


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