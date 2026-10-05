import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agentDocsPlugin } from './agent-docs-plugin.mjs';
import { runDoctor } from './mainbrella-doctor.mjs';
import { verify } from './mainbrella-verify.mjs';

const existing = { id: 'small', createdAt: '2026-10-05T12:00:00.000Z', status: 'running' };
const created = { id: 'c1', createdAt: '2026-10-05T12:01:00.000Z', status: 'running' };
const state = containers => ({ active: true, containers, imageCatalog: [{ id: 'node', name: 'Node' }],
  limits: { maxContainers: 5, maxStartsPerMonth: 10 }, usage: { starts: 1 } });
const key = 'mb_do_not_print_this';

test('doctor checks prerequisites and account access using only GETs without leaking credentials', async () => {
  const calls = [];
  const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, toolAvailable: () => true,
    fetcher: async (url, options) => {
      calls.push(url.pathname);
      assert.equal(options.method, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      return Response.json(url.pathname === '/containers' ? state([existing]) : { images: [], buildsEnabled: false });
    } });
  assert.equal(report.ok, true);
  assert.deepEqual(calls, ['/containers', '/images']);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('doctor reports revoked keys and service failures without echoing server bodies', async () => {
  for (const status of [401, 503]) {
    const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, toolAvailable: () => true,
      fetcher: async () => Response.json({ error: key }, { status }) });
    assert.equal(report.ok, false);
    assert.equal(JSON.stringify(report).includes(key), false);
    assert.ok(report.checks.some(item => item.message.includes(`HTTP ${status}`)));
  }
});

test('doctor rejects missing keys, unsafe origins, malformed responses, and exhausted allowance', async () => {
  for (const env of [{}, { MAINBRELLA_API_KEY: key, MAINBRELLA_API_URL: 'http://untrusted.example' },
    { MAINBRELLA_API_KEY: key, MAINBRELLA_API_URL: 'https://api.example/?key=secret' }]) {
    const report = await runDoctor({ env, toolAvailable: () => true, fetcher: () => assert.fail('must not send credentials') });
    assert.equal(report.ok, false);
  }
  for (const body of [null, {}, { ...state([existing]), active: false },
    { ...state([existing]), usage: { starts: 10 } }]) {
    const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, toolAvailable: () => true,
      fetcher: async () => Response.json(body) });
    assert.equal(report.ok, false);
  }
});

function scenario({ execute = async () => ({ stdout: 'hello from mainbrella\n', exitCode: 0 }),
  launch = state([existing, created]), cleanupFails = false } = {}) {
  const calls = [];
  return { calls, options: { execute, request: async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (method === 'DELETE') {
      const query = new URL(path, 'https://api.example').searchParams;
      assert.equal(query.get('id'), created.id);
      assert.equal(query.get('createdAt'), created.createdAt);
      if (cleanupFails) throw new Error('outage');
      return state([existing]);
    }
    if (path === '/containers/ssh') {
      assert.deepEqual(body, { id: created.id, createdAt: created.createdAt });
      return { command: 'private' };
    }
    if (method === 'POST') {
      if (launch instanceof Error) throw launch;
      return launch;
    }
    return state([existing]);
  } } };
}

test('verification checks stdout/exit and deletes only the created generation', async () => {
  const { options, calls } = scenario();
  const report = await verify(options);
  assert.equal(report.ok, true);
  assert.equal(report.stdout, 'hello from mainbrella');
  assert.equal(report.exitCode, 0);
  assert.equal(report.cleanup, 'completed');
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/containers').length, 1);
});

test('verification cleans up after SSH failures and never prints unexpected output', async () => {
  for (const execute of [async () => ({ stdout: key, exitCode: 255 }), async () => { throw new Error(key); }]) {
    const report = await verify(scenario({ execute }).options);
    assert.equal(report.ok, false);
    assert.equal(report.cleanup, 'completed');
    assert.equal(JSON.stringify(report).includes(key), false);
  }
});

test('verification reports cleanup failure with the generation needed for recovery', async () => {
  const report = await verify(scenario({ cleanupFails: true }).options);
  assert.equal(report.ok, false);
  assert.equal(report.cleanup, 'failed');
  assert.deepEqual(report.container, { id: created.id, createdAt: created.createdAt });
});

test('verification never retries ambiguous creation or deletes guessed ownership', async () => {
  for (const launch of [new Error('timeout'), state([existing, created, { ...created, id: 'c2' }])]) {
    const { options, calls } = scenario({ launch });
    const report = await verify(options);
    assert.equal(report.error, 'creation_ambiguous');
    assert.equal(report.cleanup, 'reconcile_manually');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  }
});

test('verification does not start when the selected image is unavailable', async () => {
  const { options, calls } = scenario();
  const report = await verify({ ...options, catalogId: 'python' });
  assert.equal(report.error, 'preflight_failed');
  assert.equal(calls.some(call => call.method === 'POST'), false);
});

test('publication emits source documents and runnable tools; backend docs stay synchronized', async () => {
  const emitted = [];
  await agentDocsPlugin().generateBundle.call({ emitFile: asset => emitted.push(asset) });
  assert.deepEqual(emitted.map(asset => asset.fileName), ['SKILL.md', 'API.md', 'mainbrella-doctor.mjs', 'mainbrella-verify.mjs']);
  for (const file of ['SKILL.md', 'API.md']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(emitted.find(asset => asset.fileName === file).source, source);
    assert.equal(await readFile(new URL(`../../backend/${file}`, import.meta.url), 'utf8'), source);
  }
});
