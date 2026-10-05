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
  const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, 
    fetcher: async (url, options) => {
      calls.push(url.pathname);
      assert.equal(options.method, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      return Response.json(url.pathname === '/containers' ? state([existing])
        : url.pathname === '/openapi.json' ? { paths: {
          '/containers/exec': { post: { operationId: 'executeContainerCommand' } },
          '/containers/files': { get: { operationId: 'readContainerFile' }, put: { operationId: 'writeContainerFile' } },
        } }
          : { images: [], buildsEnabled: false });
    } });
  assert.equal(report.ok, true);
  assert.deepEqual(calls, ['/containers', '/images', '/openapi.json']);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('doctor reports revoked keys and service failures without echoing server bodies', async () => {
  for (const status of [401, 503]) {
    const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, 
      fetcher: async () => Response.json({ error: key }, { status }) });
    assert.equal(report.ok, false);
    assert.equal(JSON.stringify(report).includes(key), false);
    assert.ok(report.checks.some(item => item.message.includes(`HTTP ${status}`)));
  }
});

test('doctor rejects missing keys, unsafe origins, malformed responses, and exhausted allowance', async () => {
  for (const env of [{}, { MAINBRELLA_API_KEY: key, MAINBRELLA_API_URL: 'http://untrusted.example' },
    { MAINBRELLA_API_KEY: key, MAINBRELLA_API_URL: 'https://api.example/?key=secret' }]) {
    const report = await runDoctor({ env, fetcher: () => assert.fail('must not send credentials') });
    assert.equal(report.ok, false);
  }
  for (const body of [null, {}, { ...state([existing]), active: false },
    { ...state([existing]), usage: { starts: 10 } }]) {
    const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, 
      fetcher: async () => Response.json(body) });
    assert.equal(report.ok, false);
  }
});

function scenario({ execute = async () => ({ stdout: 'hello from mainbrella\n', exitCode: 0, timedOut: false, outputTruncated: false }),
  readBytes, fileFailure = false,
  launch = { ...state([existing, created]), creation: { id: 'operation-one', containerId: created.id, createdAt: created.createdAt, status: 'running' } }, cleanupFails = false } = {}) {
  const calls = [];
  let uploaded;
  return { calls, options: { wait: async () => {}, request: async (path, method = 'GET', body, headers) => {
    calls.push({ path, method, body, headers });
    if (path.startsWith('/containers/files?')) {
      const params = new URL(path, 'https://api.example').searchParams;
      assert.equal(params.get('id'), created.id);
      assert.equal(params.get('createdAt'), created.createdAt);
      assert.match(params.get('path'), /^\/tmp\/mainbrella-verify-[\w-]+\.bin$/);
      if (fileFailure) throw new Error(key);
      if (method === 'PUT') {
        assert.ok(body instanceof Uint8Array);
        assert.equal(headers['Content-Type'], 'application/octet-stream');
        uploaded = body.slice();
        return { path: params.get('path'), size: body.byteLength };
      }
      return readBytes ?? uploaded;
    }
    if (method === 'DELETE') {
      const query = new URL(path, 'https://api.example').searchParams;
      assert.equal(query.get('id'), created.id);
      assert.equal(query.get('createdAt'), created.createdAt);
      if (cleanupFails) throw new Error('outage');
      return state([existing]);
    }
    if (path.startsWith('/containers/exec?')) {
      const params = new URL(path, 'https://api.example').searchParams;
      assert.equal(params.get('id'), created.id);
      assert.equal(params.get('createdAt'), created.createdAt);
      assert.deepEqual(body, { command: 'echo "hello from mainbrella"', timeoutMs: 30_000 });
      return execute();
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
  assert.equal(report.files, 'verified');
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/containers').length, 1);
});

test('verification rejects corrupted binary files and file failures, cleans up, and hides diagnostics', async () => {
  for (const options of [{ readBytes: new Uint8Array([0, 1, 127, 128, 254, 10]) },
    { readBytes: new Uint8Array() }, { fileFailure: true }]) {
    const report = await verify(scenario(options).options);
    assert.equal(report.ok, false);
    assert.equal(report.error, 'file_verification_failed');
    assert.equal(report.cleanup, 'completed');
    assert.equal(JSON.stringify(report).includes(key), false);
  }
});

test('doctor detects deployments missing file APIs before paid verification', async () => {
  const report = await runDoctor({ env: { MAINBRELLA_API_KEY: key }, fetcher: async url => Response.json(
    url.pathname === '/containers' ? state([]) : url.pathname === '/images' ? { images: [], buildsEnabled: false }
      : { paths: { '/containers/exec': { post: { operationId: 'executeContainerCommand' } } } }) });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(item => item.name === 'http_files').ok, false);
});

test('verification cleans up after HTTP execution failures and never prints unexpected output', async () => {
  for (const execute of [async () => ({ stdout: key, exitCode: 255 }), async () => { throw new Error(key); },
    async () => ({ stdout: 'hello from mainbrella', exitCode: 0, timedOut: true, outputTruncated: false }),
    async () => ({ stdout: 'hello from mainbrella', exitCode: 0, timedOut: false, outputTruncated: true })]) {
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

test('verification retries with one key and never deletes guessed ownership', async () => {
  for (const launch of [new Error('timeout'), state([existing, created, { ...created, id: 'c2' }])]) {
    const { options, calls } = scenario({ launch });
    const report = await verify(options);
    assert.equal(report.error, 'creation_ambiguous');
    assert.equal(report.cleanup, 'reconcile_manually');
    const starts = calls.filter(call => call.method === 'POST');
    assert.equal(starts.length, 3);
    assert.equal(new Set(starts.map(call => call.headers['Idempotency-Key'])).size, 1);
    assert.equal(report.creationKey, starts[0].headers['Idempotency-Key']);
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


test('verification uses operation identity with concurrent starts and recovers a lost response', async () => {
  const { options, calls } = scenario({ launch: {
    ...state([existing, created, { ...created, id: 'c2' }]),
    creation: { id: 'owned-operation', containerId: created.id, createdAt: created.createdAt, status: 'running' },
  } });
  const original = options.request; let starts = 0;
  options.request = async (...args) => {
    const response = await original(...args);
    if (args[1] === 'POST' && args[0] === '/containers' && ++starts === 1) throw new Error('lost response');
    return response;
  };
  const report = await verify(options);
  assert.equal(report.ok, true);
  assert.deepEqual(report.container, { id: created.id, createdAt: created.createdAt });
  const requests = calls.filter(call => call.path === '/containers' && call.method === 'POST');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
});


test('verification polls starting operations with the same key before executing', async () => {
  const { options, calls } = scenario(); const original = options.request;
  let starts = 0;
  options.request = async (...args) => {
    const response = await original(...args);
    if (args[0] === '/containers' && args[1] === 'POST' && ++starts === 1) {
      return { ...response, creation: { ...response.creation, status: 'starting' } };
    }
    return response;
  };
  assert.equal((await verify(options)).ok, true);
  const launches = calls.filter(call => call.path === '/containers' && call.method === 'POST');
  assert.equal(launches.length, 2);
  assert.equal(launches[0].headers['Idempotency-Key'], launches[1].headers['Idempotency-Key']);
});
