import assert from 'node:assert/strict';
import test from 'node:test';
import { createPulse } from '../src/index.js';

const credentials = {
  endpoint: 'https://ingest.example.test',
  apiKey: `pulse_api_${'w'.repeat(48)}`,
  environment: 'production',
};

test('configures without a service type and sends IP and User-Agent with the event', async () => {
  let body = '';
  const pulse = createPulse({
    endpoint: 'https://ingest.example.test',
    apiKey: `pulse_api_${'a'.repeat(48)}`,
    environment: 'production',
    fetch: async (_url, init) => {
      body = String(init?.body);

      return new Response('{}', { status: 202 });
    },
    now: () => new Date('2026-08-25T12:30:00.000Z'),
  });

  pulse.observeRequest({
    method: 'GET',
    statusCode: 200,
    userAgent: 'ChatGPT-User/1.0',
    accept: 'text/markdown',
    ip: '203.0.113.42',
    url: 'https://Example.COM:443/docs/quickstart/?token=must-not-leak#install',
    surface: 'markdown',
    surfaceName: 'home',
  });
  await pulse.flush();

  assert.equal(pulse.diagnostics().configured, true);
  const payload = JSON.parse(body);
  assert.equal(payload.schema_version, 2);
  const event = payload.events[0];
  assert.equal(event.session_id, 'cc88c7a5ab5992ccba6d890dc430b89373bb7bbd81eae859ed2d608d12f1fc15');
  assert.equal(event.ip, '203.0.113.42');
  assert.equal(event.user_agent, 'ChatGPT-User/1.0');
  assert.equal(event.page_url, 'https://example.com/docs/quickstart');
  assert.equal(event.page_path, '/docs/quickstart');
  assert.doesNotMatch(body, /must-not-leak|#install/);
});

test('classifies locally while excluding unrelated sensitive request data', async () => {
  const bodies: string[] = [];
  const pulse = createPulse({
    ...credentials,
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response('{}', { status: 202 });
    },
    now: () => new Date('2026-08-25T12:30:00.000Z'),
  });

  pulse.observeRequest({
    method: 'GET',
    statusCode: 200,
    headers: { 'user-agent': 'ChatGPT-User/1.0 secret', accept: 'text/markdown', authorization: 'Bearer nope', cookie: 'sid=nope' },
    ip: '203.0.113.42',
    url: 'https://example.test/guides/pulse?token=nope#secret',
    surface: 'markdown',
    surfaceName: 'home',
    durationMs: 17,
  });
  await pulse.flush();

  assert.equal(bodies.length, 1);
  const raw = bodies[0]!;
  assert.doesNotMatch(raw, /Bearer|sid=|token=|#secret/);
  const event = JSON.parse(raw).events[0];
  assert.deepEqual(
    { category: event.category, confidence: event.confidence, agent_family: event.agent_family, surface: event.surface },
    { category: 'interactive_agent', confidence: 'high', agent_family: 'chatgpt', surface: 'markdown' },
  );
  assert.equal(event.ip, '203.0.113.42');
  assert.equal(event.user_agent, 'ChatGPT-User/1.0 secret');
  assert.equal(event.page_url, 'https://example.test/guides/pulse');
  assert.equal(event.page_path, '/guides/pulse');
  assert.equal(event.session_id, '42368bd8078350021a4e48593f9255ab9a7dc190103d34675943f79b1bae169b');
});

test('uses the previous UTC hour alias for the first five minutes', async () => {
  let body = '';
  const pulse = createPulse({
    ...credentials,
    fetch: async (_url, init) => { body = String(init?.body); return new Response('{}', { status: 202 }); },
    now: () => new Date('2026-08-25T13:03:00.000Z'),
  });
  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Codex/1.0', accept: 'application/json', ip: '2001:db8:abcd:12::4', url: 'https://example.test/data', surface: 'api', surfaceName: 'public-api' });
  await pulse.flush();
  const event = JSON.parse(body).events[0];
  assert.equal(event.session_id, 'afc8634799f6ce78335fe3193d023e43c861b5369834bee3e36a33599a414145');
});

test('counts public GET and HEAD pages with 2xx through 4xx while excluding assets, private paths, and mutations', async () => {
  let body = '';
  const pulse = createPulse({
    ...credentials,
    publicApiPrefixes: ['/api/public', '/api/accounts'],
    fetch: async (_url, init) => { body = String(init?.body); return new Response('{}', { status: 202 }); },
  });
  const request = (method: string, statusCode: number, url: string) => pulse.observeRequest({
    method,
    statusCode,
    userAgent: 'Claude-Code/1.0',
    accept: 'text/html',
    ip: '203.0.113.42',
    url,
  });

  request('GET', 200, 'https://example.test/docs?token=removed');
  request('HEAD', 404, 'https://example.test/llms.txt');
  request('GET', 499, 'https://example.test/missing');
  request('GET', 500, 'https://example.test/server-error');
  request('POST', 201, 'https://example.test/docs');
  request('GET', 200, 'https://example.test/assets/app.js');
  request('GET', 200, 'https://example.test/favicon.ico');
  request('GET', 200, 'https://example.test/health');
  request('HEAD', 304, 'https://example.test/api/turnstile-config');
  request('GET', 200, 'https://example.test/api/orders/123');
  request('GET', 200, 'https://example.test/api/public/catalog');
  request('GET', 200, 'https://example.test/api/accounts');
  request('GET', 200, 'https://example.test/api/auth/session');
  request('GET', 200, 'https://example.test/api/forgot-password');
  request('GET', 200, 'https://example.test/api/reset-password');
  request('GET', 200, 'https://example.test/api/profile');
  request('GET', 200, 'https://example.test/api/password');
  request('GET', 200, 'https://example.test/api/v1/agent/projects');
  request('GET', 200, 'https://example.test/agent/authorize/secret');
  request('GET', 200, 'https://example.test/email/verify');
  request('GET', 200, 'https://example.test/auth/login');
  request('GET', 200, 'https://example.test/dashboard');
  pulse.observeRequest({ method: 'POST', statusCode: 201, userAgent: 'Claude-Code/1.0', accept: 'text/html', ip: '203.0.113.42', url: 'https://example.test/docs', eligible: true });
  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Claude-Code/1.0', accept: 'text/html', ip: '203.0.113.42', url: 'https://example.test/account', eligible: true });
  await pulse.flush();

  assert.deepEqual(JSON.parse(body).events.map((event: { page_path: string }) => event.page_path), [
    '/docs',
    '/llms.txt',
    '/missing',
    '/health',
    '/api/turnstile-config',
    '/api/public/catalog',
  ]);
  const events = JSON.parse(body).events as Array<{ page_path: string; public_api_route: boolean }>;
  assert.equal(events.find((event) => event.page_path === '/docs')?.public_api_route, false);
  assert.equal(events.find((event) => event.page_path === '/api/public/catalog')?.public_api_route, true);
});

test('batches at 50 events and reports bounded queue overflow', async () => {
  const sizes: number[] = [];
  const pulse = createPulse({
    ...credentials,
    queueLimit: 500,
    fetch: async (_url, init) => { sizes.push(JSON.parse(String(init?.body)).events.length); return new Response('{}', { status: 202 }); },
  });
  for (let index = 0; index < 550; index += 1) {
    pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Mozilla/5.0 Chrome/130', accept: 'text/html', ip: '198.51.100.2', url: 'https://example.test/', surface: 'html', surfaceName: 'home' });
  }
  assert.equal(pulse.diagnostics().queued, 500);
  assert.equal(pulse.diagnostics().droppedOverflow, 50);
  await pulse.flush();
  assert.deepEqual(sizes, Array(10).fill(50));
});

test('drains observations added while a delivery is already in flight', async () => {
  const delivered: string[] = [];
  let releaseFirst!: () => void;
  const firstDelivery = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const pulse = createPulse({
    ...credentials,
    fetch: async (_url, init) => {
      delivered.push(String(init?.body));
      if (delivered.length === 1) await firstDelivery;
      return new Response('{}', { status: 202 });
    },
  });

  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'curl/8.7.1', accept: '*/*', ip: '203.0.113.42', url: 'https://example.test/health' });
  const firstFlush = pulse.flush();
  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'curl/8.7.1', accept: '*/*', ip: '203.0.113.42', url: 'https://example.test/openapi.json' });
  const joinedFlush = pulse.flush();
  releaseFirst();
  await Promise.all([firstFlush, joinedFlush]);

  assert.equal(delivered.length, 2);
  assert.match(delivered[0]!, /"page_path":"\/health"/);
  assert.match(delivered[1]!, /"page_path":"\/openapi\.json"/);
  assert.equal(pulse.diagnostics().queued, 0);
  assert.equal(pulse.diagnostics().sent, 2);
});

test('retries only 429 and 5xx, with at most three attempts', async () => {
  let retryCalls = 0;
  const retrying = createPulse({
    ...credentials,
    fetch: async () => { retryCalls += 1; return new Response('{}', { status: retryCalls < 3 ? 503 : 202 }); },
    sleep: async () => {},
    random: () => 0,
  });
  retrying.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Claude-Code/1', accept: 'application/json', ip: '203.0.113.42', url: 'https://example.test/data', surface: 'api', surfaceName: 'api' });
  await retrying.flush();
  assert.equal(retryCalls, 3);
  assert.equal(retrying.diagnostics().sent, 1);

  let badRequestCalls = 0;
  const notRetrying = createPulse({ ...credentials, fetch: async () => { badRequestCalls += 1; return new Response('{}', { status: 400 }); }, sleep: async () => {} });
  notRetrying.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Claude-Code/1', accept: 'application/json', ip: '203.0.113.42', url: 'https://example.test/data', surface: 'api', surfaceName: 'api' });
  await notRetrying.flush();
  assert.equal(badRequestCalls, 1);
  assert.equal(notRetrying.diagnostics().droppedDelivery, 1);
});

test('times out delivery after one second and never throws into the host app', async () => {
  const pulse = createPulse({
    ...credentials,
    timeoutMs: 10,
    fetch: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    sleep: async () => {},
  });
  assert.doesNotThrow(() => pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'unknown', accept: 'text/html', ip: '203.0.113.42', url: 'https://example.test/', surface: 'html', surfaceName: 'home' }));
  await assert.doesNotReject(() => pulse.flush());
  assert.equal(pulse.diagnostics().droppedDelivery, 1);
});

test('drops observations that cannot send both IP and User-Agent', async () => {
  let deliveries = 0;
  const pulse = createPulse({
    ...credentials,
    fetch: async () => {
      deliveries += 1;
      return new Response('{}', { status: 202 });
    },
  });

  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Codex/1.0' });
  pulse.observeRequest({ method: 'GET', statusCode: 200, ip: '203.0.113.42' });
  await pulse.flush();

  assert.equal(deliveries, 0);
  assert.equal(pulse.diagnostics().accepted, 0);
  assert.equal(pulse.diagnostics().droppedInvalid, 2);
});

test('disabled mode is a safe no-op', async () => {
  const pulse = createPulse({ enabled: false });
  pulse.observeRequest({ method: 'GET', statusCode: 200, headers: { authorization: 'secret' }, url: '/private' });
  await pulse.flush();
  assert.deepEqual(pulse.diagnostics(), {
    enabled: false,
    configured: false,
    queued: 0,
    accepted: 0,
    sent: 0,
    droppedOverflow: 0,
    droppedInvalid: 0,
    droppedDelivery: 0,
    lastError: null,
  });
});
