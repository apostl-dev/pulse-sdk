import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { createPulse } from '../src/index.js';

test('accepts and flushes a 250 events-per-second envelope without loss', async () => {
  const batchSizes: number[] = [];
  const pulse = createPulse({
    endpoint: 'https://ingest.example.test',
    apiKey: `pulse_api_${'w'.repeat(48)}`,
    service: 'load-test',
    environment: 'test',
    flushIntervalMs: 0,
    fetch: async (_url, init) => {
      batchSizes.push(JSON.parse(String(init?.body)).events.length);

      return new Response('{}', { status: 202 });
    },
  });

  const startedAt = performance.now();
  for (let index = 0; index < 250; index += 1) {
    pulse.observeRequest({
      method: 'GET',
      statusCode: 200,
      userAgent: 'Codex/1.0',
      accept: 'text/markdown',
      ip: `198.51.100.${index % 255}`,
      surface: 'markdown',
      surfaceName: 'load-test',
    });
  }
  await pulse.flush();
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(batchSizes, [50, 50, 50, 50, 50]);
  assert.deepEqual(pulse.diagnostics(), {
    enabled: true,
    configured: true,
    queued: 0,
    accepted: 250,
    sent: 250,
    droppedOverflow: 0,
    droppedInvalid: 0,
    droppedDelivery: 0,
    lastError: null,
  });
  assert.ok(elapsedMs < 1_000, `expected 250 events to flush within one second, observed ${elapsedMs.toFixed(1)}ms`);
});
