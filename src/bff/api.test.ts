import test from 'node:test';
import assert from 'node:assert/strict';
import { createBffApi } from './api';

test('BFF browser requests use the configured API and session cookies', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async (url, options) => {
    assert.equal(url, 'https://api-stg.mainbrella.com/bff/projects');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.body, JSON.stringify({ name: 'My app' }));
    return Response.json({ project: { name: 'My app' } });
  }) as typeof fetch;
  const request = createBffApi('https://api-stg.mainbrella.com');
  assert.deepEqual(await request('/projects', 'POST', { name: 'My app' }), { project: { name: 'My app' } });
});
test('expired sessions clear the workspace and provider failures stay human-readable', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let expired = 0;
  const request = createBffApi('', () => { expired++; });
  globalThis.fetch = (async () => Response.json({ error: 'unauthorized' }, { status: 401 })) as typeof fetch;
  await assert.rejects(request('/projects'), /session has expired/);
  assert.equal(expired, 1);
  globalThis.fetch = (async () => Response.json({ error: 'database_query_failed', private: 'provider-secret' }, { status: 502 })) as typeof fetch;
  await assert.rejects(request('/projects/id/query', 'POST', { sql: 'SELECT 1' }), error => error instanceof Error && /SQLite/.test(error.message) && !error.message.includes('provider-secret'));
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  await assert.rejects(request('/projects'), /Check your connection/);
});
