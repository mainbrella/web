import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark } from './mainbrella-benchmark.mjs';

function fixture({ allowance = 10, slots = 5, ambiguous = false, cleanupFailure = false,
  executionFailure = false, lostResponse = false } = {}) {
  const existing = { id: 'existing', createdAt: '2026-10-05T12:00:00Z', status: 'running' };
  const containers = [existing], operations = new Map(), files = new Map(), deleted = [];
  let time = 0, attempted = 0;
  const state = () => ({ active: true, plan: 'builder', containers: [...containers],
    limits: { maxContainers: slots + 1, maxStartsPerMonth: allowance }, usage: { starts: attempted },
    imageCatalog: [{ id: 'node' }] });
  return { deleted, operations, options: { now: () => time++, wait: async () => {},
    request: async (path, method = 'GET', body, headers) => {
      if (path === '/containers' && method === 'GET') return state();
      if (path === '/containers' && method === 'POST') {
        const key = headers['Idempotency-Key'];
        if (!operations.has(key)) {
          attempted++;
          const container = { id: `created-${attempted}`, createdAt: `2026-10-05T12:00:0${attempted}Z`, instance: 'lite', status: 'running' };
          containers.push(container);
          operations.set(key, { id: key, containerId: container.id, createdAt: container.createdAt, status: 'running' });
          if (lostResponse) throw new Error('secret-server-diagnostic');
        }
        if (ambiguous) throw new Error('secret-server-diagnostic');
        return { ...state(), creation: operations.get(key) };
      }
      const params = new URL(path, 'https://api.example').searchParams;
      const owned = containers.find(container => container.id === params.get('id')
        && container.createdAt === params.get('createdAt'));
      assert.ok(owned);
      assert.notEqual(owned.id, existing.id);
      if (method === 'DELETE') {
        if (cleanupFailure) throw new Error('secret-server-diagnostic');
        deleted.push(owned);
        containers.splice(containers.indexOf(owned), 1);
        return state();
      }
      if (path.startsWith('/containers/exec?')) {
        if (executionFailure) throw new Error('secret-server-diagnostic');
        return { stdout: 'hello from mainbrella\n', exitCode: 0, timedOut: false, outputTruncated: false };
      }
      if (method === 'PUT') { files.set(owned.id, body); return { size: body.byteLength }; }
      return files.get(owned.id);
    } } };
}

test('benchmark retains raw timings, uses nearest rank, and cleans up exact owned generations', async () => {
  const f = fixture();
  const times = [0, 10, 15, 20, 40, 45, 50, 90, 95];
  const result = await runBenchmark({ ...f.options, now: () => times.shift(),
    samples: 3, concurrency: 1, metadata: { clientLocation: 'test' } });
  assert.equal(result.ok, true);
  assert.equal(result.attempted, 3);
  assert.equal(f.deleted.length, 3);
  assert.deepEqual(result.samples.map(sample => [sample.createMs, sample.firstCommandMs]), [[10, 15], [20, 25], [40, 45]]);
  assert.deepEqual(result.summary.create, { count: 3, p50Ms: 20, p95Ms: 40 });
  assert.equal(result.environment.clientLocation, 'test');
  assert.ok(result.samples.every(sample => sample.instance === 'lite' && sample.files === 'verified'));
});

test('concurrent benchmark preserves unique operation identities and existing containers', async () => {
  const f = fixture({ lostResponse: true });
  const result = await runBenchmark({ ...f.options, samples: 4, concurrency: 2 });
  assert.equal(result.ok, true);
  assert.equal(f.operations.size, 4);
  assert.equal(f.deleted.length, 4);
  assert.ok(result.samples.every(sample => sample.createRequests === 2 && sample.createMs > 0));
});

test('invalid sizes and insufficient full-run allowance never reserve containers', async () => {
  for (const [samples, concurrency, config] of [[0, 1, {}], [3, 4, {}], [1.5, 1, {}],
    [1001, 1, {}], [3, 1, { allowance: 2 }], [3, 3, { slots: 2 }]]) {
    const f = fixture(config);
    assert.equal((await runBenchmark({ ...f.options, samples, concurrency })).ok, false);
    assert.equal(f.operations.size, 0);
  }
});

test('failed or ambiguous batches stop further scheduling, retain recovery identity, and omit failed percentiles', async () => {
  for (const config of [{ ambiguous: true }, { cleanupFailure: true }, { executionFailure: true }]) {
    const f = fixture(config);
    const result = await runBenchmark({ ...f.options, samples: 4, concurrency: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.requested, 4);
    assert.equal(result.attempted, 2);
    assert.equal(result.successful, 0);
    assert.deepEqual(result.summary.create, { count: 0, p50Ms: null, p95Ms: null });
    assert.equal(JSON.stringify(result).includes('secret-server-diagnostic'), false);
    assert.ok(result.samples.every(sample => config.ambiguous ? sample.creationKey : sample.container));
    assert.equal(f.deleted.length, config.executionFailure ? 2 : 0);
  }
});
