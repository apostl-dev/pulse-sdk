import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createPulse } from '../src/index.js';

const credentials = {
  endpoint: 'https://ingest.example.test',
  writeKey: `pulse_wk_${'w'.repeat(48)}`,
  identitySecret: `pulse_is_${'i'.repeat(48)}`,
  service: 'landing',
  environment: 'production',
};

test('classifies locally, hashes network context, and never emits raw request data', async () => {
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
    url: '/private?token=nope',
    surface: 'markdown',
    surfaceName: 'home',
    durationMs: 17,
  });
  await pulse.flush();

  assert.equal(bodies.length, 1);
  const raw = bodies[0]!;
  assert.doesNotMatch(raw, /203\.0\.113\.42|ChatGPT-User|secret|Bearer|sid=|private|token=/);
  const event = JSON.parse(raw).events[0];
  assert.deepEqual(
    { category: event.category, confidence: event.confidence, agent_family: event.agent_family, surface: event.surface },
    { category: 'interactive_agent', confidence: 'high', agent_family: 'chatgpt', surface: 'markdown' },
  );
  const identity = 'production|landing|chatgpt|markdown|203.0.113.0|496572';
  assert.equal(event.session_id, createHmac('sha256', credentials.identitySecret).update(identity).digest('hex'));
});

test('uses the previous UTC hour alias for the first five minutes', async () => {
  let body = '';
  const pulse = createPulse({
    ...credentials,
    fetch: async (_url, init) => { body = String(init?.body); return new Response('{}', { status: 202 }); },
    now: () => new Date('2026-08-25T13:03:00.000Z'),
  });
  pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Codex/1.0', accept: 'application/json', ip: '2001:db8:abcd:12::4', surface: 'api', surfaceName: 'public-api' });
  await pulse.flush();
  const event = JSON.parse(body).events[0];
  const identity = 'production|landing|codex|json|2001:db8:abcd:12::/64|496572';
  assert.equal(event.session_id, createHmac('sha256', credentials.identitySecret).update(identity).digest('hex'));
});

test('batches at 50 events and reports bounded queue overflow', async () => {
  const sizes: number[] = [];
  const pulse = createPulse({
    ...credentials,
    queueLimit: 500,
    fetch: async (_url, init) => { sizes.push(JSON.parse(String(init?.body)).events.length); return new Response('{}', { status: 202 }); },
  });
  for (let index = 0; index < 550; index += 1) {
    pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Mozilla/5.0 Chrome/130', accept: 'text/html', ip: '198.51.100.2', surface: 'html', surfaceName: 'home' });
  }
  assert.equal(pulse.diagnostics().queued, 500);
  assert.equal(pulse.diagnostics().droppedOverflow, 50);
  await pulse.flush();
  assert.deepEqual(sizes, Array(10).fill(50));
});

test('retries only 429 and 5xx, with at most three attempts', async () => {
  let retryCalls = 0;
  const retrying = createPulse({
    ...credentials,
    fetch: async () => { retryCalls += 1; return new Response('{}', { status: retryCalls < 3 ? 503 : 202 }); },
    sleep: async () => {},
    random: () => 0,
  });
  retrying.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Claude-Code/1', accept: 'application/json', surface: 'api', surfaceName: 'api' });
  await retrying.flush();
  assert.equal(retryCalls, 3);
  assert.equal(retrying.diagnostics().sent, 1);

  let badRequestCalls = 0;
  const notRetrying = createPulse({ ...credentials, fetch: async () => { badRequestCalls += 1; return new Response('{}', { status: 400 }); }, sleep: async () => {} });
  notRetrying.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'Claude-Code/1', accept: 'application/json', surface: 'api', surfaceName: 'api' });
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
  assert.doesNotThrow(() => pulse.observeRequest({ method: 'GET', statusCode: 200, userAgent: 'unknown', accept: 'text/html', surface: 'html', surfaceName: 'home' }));
  await assert.doesNotReject(() => pulse.flush());
  assert.equal(pulse.diagnostics().droppedDelivery, 1);
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
