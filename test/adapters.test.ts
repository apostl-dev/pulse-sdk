import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { pulseExpressMiddleware } from '../src/express.js';
import { withPulse } from '../src/next.js';
import type { ObserveRequestInput, PulseClient } from '../src/index.js';

function observingClient(observed: unknown[]): PulseClient {
  return {
    observeRequest: (input: ObserveRequestInput) => observed.push(input),
    flush: async () => {},
    close: async () => {},
    diagnostics: () => ({ enabled: true, configured: true, queued: 0, accepted: 0, sent: 0, droppedOverflow: 0, droppedInvalid: 0, droppedDelivery: 0, lastError: null }),
  };
}

test('Express adapter observes after finish without changing middleware flow', async () => {
  const observed: unknown[] = [];
  const req = { method: 'GET', headers: { accept: 'text/html' }, ip: '192.0.2.4', originalUrl: '/' };
  const res = Object.assign(new EventEmitter(), { statusCode: 204 });
  let nextCalls = 0;
  pulseExpressMiddleware(observingClient(observed), () => ({ surface: 'html', surfaceName: 'home' }))(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  res.emit('finish');
  assert.equal(observed.length, 1);
  assert.equal((observed[0] as { statusCode: number }).statusCode, 204);
});

test('Next adapter preserves the original response and observes it', async () => {
  const observed: unknown[] = [];
  const response = new Response('ok', { status: 201, headers: { 'content-type': 'text/markdown' } });
  const wrapped = withPulse(observingClient(observed), async () => response, () => ({ surface: 'markdown', surfaceName: 'home' }));
  const actual = await wrapped(new Request('https://example.test/', {
    headers: {
      accept: 'text/markdown',
      'user-agent': 'Claude-Code/1.0',
      'x-forwarded-for': '203.0.113.42, 10.0.0.1',
    },
  }));
  assert.equal(actual, response);
  assert.equal(observed.length, 1);
  assert.equal((observed[0] as { statusCode: number }).statusCode, 201);
  assert.equal((observed[0] as { ip: string }).ip, '203.0.113.42, 10.0.0.1');
});
