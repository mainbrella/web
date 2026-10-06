import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: 'localhost' };
const { lifecyclePage, workloadSummary, createObservationClient } = await import('./container-observations.js');
const container = { id: 'small', createdAt: '2026-10-05T12:00:00.000Z' };
const event = { id: 'd688d42a-25ef-4c13-9b28-21a0fde6e163', sequence: 1, createdAt: container.createdAt, occurredAt: container.createdAt, type: 'started' };
const page = { events: [event], nextCursor: 1, hasMore: false, historyTruncated: false };

test('history rejects foreign generations, duplicate/out-of-order events and invalid continuation cursors', () => {
  assert.deepEqual(lifecyclePage({ ...page, events: [{ ...event, telemetryId: 'private' }] }, container).events[0], { ...event, reason: undefined });
  for (const value of [{ ...page, events: [{ ...event, createdAt: 'foreign' }] }, { ...page, events: [event, event] },
    { ...page, events: [{ ...event, sequence: 0 }] }, { ...page, events: [{ ...event, occurredAt: 'bad' }] },
    { ...page, events: [{ ...event, type: '<script>' }] }, { ...page, nextCursor: 2 }, { ...page, events: [], nextCursor: 0, hasMore: true }]) {
    assert.throws(() => lifecyclePage(value, container));
  }
  assert.throws(() => lifecyclePage(page, container, 1));
});

test('workload summaries keep missing CPU and RAM unknown and reject invalid numeric evidence', () => {
  const value = { ...container, state: 'observed', buckets: [{ cpuSeconds: 1, memoryPeakBytes: 100 }, { cpuSeconds: 2, memoryPeakBytes: 200 }] };
  assert.deepEqual(workloadSummary(value, container), { state: 'observed', cpuSeconds: 3, memoryPeakBytes: 200 });
  assert.deepEqual(workloadSummary({ ...value, buckets: [{ cpuSeconds: null, memoryPeakBytes: null }] }, container), { state: 'observed', cpuSeconds: null, memoryPeakBytes: null });
  assert.deepEqual(workloadSummary({ ...value, state: 'unobserved', buckets: [] }, container), { state: 'unobserved', cpuSeconds: null, memoryPeakBytes: null });
  for (const bucket of [{ cpuSeconds: -1, memoryPeakBytes: 1 }, { cpuSeconds: NaN, memoryPeakBytes: 1 }, { cpuSeconds: 1, memoryPeakBytes: undefined }]) assert.throws(() => workloadSummary({ ...value, buckets: [bucket] }, container));
  assert.throws(() => workloadSummary({ ...value, createdAt: 'foreign' }, container));
  assert.throws(() => workloadSummary({ ...value, buckets: [] }, container));
  assert.throws(() => workloadSummary({ ...value, buckets: [{ cpuSeconds: Number.MAX_VALUE, memoryPeakBytes: null }, { cpuSeconds: Number.MAX_VALUE, memoryPeakBytes: null }] }, container));
});

test('observation reads bind exact generation, do not retry, and sanitize errors', async () => {
  let calls = 0;
  const request = createObservationClient({ fetcher: async (url, options) => {
    calls++; assert.equal(url.searchParams.get('id'), container.id); assert.equal(url.searchParams.get('createdAt'), container.createdAt);
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error');
    return Response.json(page);
  } });
  assert.deepEqual(await request(container, 'events'), lifecyclePage(page, container)); assert.equal(calls, 1);
  let signedOut = false;
  const fail = createObservationClient({ onUnauthenticated() { signedOut = true; }, fetcher: async () => { calls++; return Response.json({ error: 'private detail' }, { status: 401 }); } });
  await assert.rejects(fail(container, 'events'), { message: 'observations_unavailable' }); assert.equal(signedOut, true); assert.equal(calls, 2);
  await assert.rejects(createObservationClient({ fetcher: async () => Response.json({}, { status: 404 }) })(container, 'events'), { message: 'history_expired' });
});
