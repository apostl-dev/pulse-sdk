import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('README sends first-time agents through the secret-safe setup helper', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /npx skills add apostl-dev\/apostl-skills --skill agent-traffic-analytics/);
  assert.match(readme, /reserved documentation domain/i);
  assert.match(readme, /real origin you can deploy/i);
  assert.doesNotMatch(readme, /curl -X POST https:\/\/platform\.apostl\.dev\/api\/v1\/pulse\/setups/);
  assert.doesNotMatch(readme, /connect https:\/\/docs\.example\.com/);
});
