import test from 'node:test';
import assert from 'node:assert/strict';
import { components, currentComponents, historyPath, readPublicStatus } from './status-data.js';

const now = Date.parse('2026-10-05T12:00:00.000Z');

test('current component freshness is recalculated against the supplied current time', () => {
  const status = {
    components: [{ component: 'api', state: 'degraded', checkedAt: new Date(now - 899_000).toISOString() }],
  };

  assert.equal(currentComponents(status, now).find(item => item.component === 'api').state, 'degraded');
  assert.equal(currentComponents(status, now + 2_000).find(item => item.component === 'api').state, 'unknown');
});

test('missing, future, and invalid observations are unknown', () => {
  const status = {
    components: [
      { component: 'api', state: 'operational', checkedAt: new Date(now + 1).toISOString() },
      { component: 'auth', state: 'outage', checkedAt: 'not-a-date' },
    ],
  };
  const values = new Map(currentComponents(status, now).map(item => [item.component, item.state]));

  assert.equal(values.get('api'), 'unknown');
  assert.equal(values.get('auth'), 'unknown');
  assert.equal(values.get('website'), 'unknown');
});

test('current status always includes all seven known components', () => {
  const rows = currentComponents({ components: [] }, now);

  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(item => item.component), Object.keys(components));
  assert.deepEqual(rows.map(item => item.name), Object.values(components));
  assert.ok(rows.every(item => item.state === 'unknown'));
});

test('explicitly stale observations stay unknown even while their timestamp is fresh', () => {
  const [api] = currentComponents({
    components: [{ component: 'api', state: 'operational', checkedAt: new Date(now).toISOString(), stale: true }],
  }, now).filter(item => item.component === 'api');

  assert.equal(api.state, 'unknown');
});

test('history pagination includes both cursor values and handles the end of history', () => {
  assert.equal(historyPath(null), null);
  assert.equal(historyPath({ before: '2026-10-05T11:00:00.000Z', beforeId: 42 }),
    '/status/history?before=2026-10-05T11%3A00%3A00.000Z&beforeId=42');
});

test('malformed history cursors are rejected', () => {
  for (const cursor of [
    undefined,
    {},
    { before: 'invalid', beforeId: 1 },
    { before: '2026-10-05T11:00:00.000Z', beforeId: 0 },
    { before: '2026-10-05T11:00:00.000Z', beforeId: -1 },
    { before: '2026-10-05T11:00:00.000Z', beforeId: 1.5 },
    { before: '2026-10-05T11:00:00.000Z', beforeId: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => historyPath(cursor), /Invalid history cursor/);
});

test('public status reads omit credentials and accept valid status and history payloads', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.pathname === '/status'
      ? { components: [], incidents: [] }
      : { observations: [], next: null } };
  };

  const status = await readPublicStatus('/status', { origin: 'https://status.example', fetcher });
  const history = await readPublicStatus('/status/history', { origin: 'https://status.example', fetcher });

  assert.deepEqual(status, { components: [], incidents: [] });
  assert.deepEqual(history, { observations: [], next: null });
  assert.deepEqual(requests.map(({ options }) => options.credentials), ['omit', 'omit']);
  assert.ok(requests.every(({ options }) => options.redirect === 'error'));
  assert.ok(requests.every(({ options }) => options.headers.Accept === 'application/json'));
});

test('public status reads reject HTTP errors and malformed status or history payloads', async () => {
  const read = response => readPublicStatus('/status', { origin: 'https://status.example', fetcher: async () => response });
  await assert.rejects(read({ ok: false }), /Status unavailable/);
  await assert.rejects(read({ ok: true, json: async () => ({ incidents: [] }) }), /Status unavailable/);
  await assert.rejects(read({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }), /bad json/);

  const readHistory = payload => readPublicStatus('/status/history', {
    origin: 'https://status.example', fetcher: async () => ({ ok: true, json: async () => payload }),
  });
  await assert.rejects(readHistory({}), /History unavailable/);
  await assert.rejects(readHistory({ observations: [], next: { before: 'invalid', beforeId: 2 } }), /Invalid history cursor/);
});
