import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('production image includes the Coolify healthcheck client', async () => {
  const dockerfile = await readFile(resolve('examples/onboarding-canary/Dockerfile'), 'utf8');

  assert.match(dockerfile, /apk add --no-cache curl/);
});

test('production canary answers the signed challenge and sends the exact real request', async (t) => {
  const batches: Array<Record<string, unknown>> = [];
  const ingest = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    batches.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted_event_ids: ['accepted'], rejected: [] }));
  });
  ingest.listen(0, '127.0.0.1');
  await once(ingest, 'listening');
  t.after(() => ingest.close());

  const port = await availablePort();
  const apiKey = `pulse_api_${'k'.repeat(48)}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.mjs'], {
    cwd: resolve('examples/onboarding-canary'),
    env: {
      ...process.env,
      PORT: String(port),
      APOSTL_PULSE_API_KEY: apiKey,
      APOSTL_PULSE_ENDPOINT: `http://127.0.0.1:${(ingest.address() as { port: number }).port}`,
      APOSTL_PULSE_MODULE: pathToFileURL(resolve('src/index.ts')).href,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  });

  const challenge = `verify-${'z'.repeat(24)}`;
  const response = await fetch(`http://127.0.0.1:${port}/llms.txt?secret=removed`, {
    headers: {
      accept: 'text/plain',
      'cf-connecting-ip': '203.0.113.42',
      'user-agent': 'Apostl-Pulse-Verifier/1.0',
      'x-forwarded-host': 'test-website.apostl.dev',
      'x-apostl-pulse-challenge': challenge,
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-apostl-pulse-page'), 'https://test-website.apostl.dev/llms.txt');
  assert.match(response.headers.get('x-apostl-pulse-proof') ?? '', /^v1:[0-9a-f]{64}$/);

  await waitFor(() => batches.length === 1);
  const serialized = JSON.stringify(batches[0]);
  assert.match(serialized, /203\.0\.113\.42/);
  assert.match(serialized, /Apostl-Pulse-Verifier\/1\.0/);
  assert.match(serialized, /https:\/\/test-website\.apostl\.dev\/llms\.txt/);
  assert.doesNotMatch(serialized, /secret=removed/);
});

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('condition did not become true');
}
