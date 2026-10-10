import test from 'node:test';
import assert from 'node:assert/strict';
import type { BuildApp } from './build-api.ts';

Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { BuildAPIError, buildErrorMessage, createBuildClient, safeBuildPreviewURL } = await import('./build-api.ts');
const app = { id: '93be2248-9214-4c8a-94ac-20469f7aca72', revision: 3 } as BuildApp;

test('preview frames accept only token origins on the separate preview domain or localhost', () => {
  const token = 'a'.repeat(48);
  assert.equal(safeBuildPreviewURL(`https://${token}.mainbrella.dev/`), `https://${token}.mainbrella.dev/`);
  assert.equal(safeBuildPreviewURL(`http://${token}.localhost:8788/`), `http://${token}.localhost:8788/`);
  for (const url of ['javascript:alert(1)', '/dashboard/', 'https://mainbrella.com/',
    `https://${token}.mainbrella.dev.evil.test/`, `https://${token}.other.mainbrella.dev/`,
    `https://owner@${token}.mainbrella.dev/`, `https://${token}.mainbrella.dev:444/`,
    `http://${token}.mainbrella.dev/`, 'https://short.mainbrella.dev/']) {
    assert.equal(safeBuildPreviewURL(url), null, url);
  }
});

test('build submissions send cookies, stable retry keys and the exact base revision', async t => {
  const requests: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    requests.push({ url, options }); return Response.json({ app });
  });
  const client = createBuildClient(() => assert.fail('authenticated request'));
  await client.create('An expense tracker', 'create-key');
  await client.turn(app, 'Add CSV export', 'change-key');
  await client.turn(app, 'Add CSV export', 'change-key');
  await client.preview(app, 'preview-key');
  assert.deepEqual(JSON.parse(requests[0].options.body as string), { prompt: 'An expense tracker' });
  assert.deepEqual(JSON.parse(requests[1].options.body as string), { mode: 'build', prompt: 'Add CSV export', revision: 3 });
  assert.deepEqual(requests[1], requests[2]);
  assert.deepEqual(JSON.parse(requests[3].options.body as string), { mode: 'preview', revision: 3 });
  for (const request of requests) {
    assert.equal(request.options.credentials, 'include');
    assert.equal(request.options.redirect, 'error');
    assert.ok((request.options.headers as Record<string, string>)['Idempotency-Key']);
  }
});

test('funding and revision errors retain their public codes and human-readable recovery', async t => {
  const client = createBuildClient(() => {});
  for (const [status, error] of [[402, 'subscription_required'], [409, 'revision_conflict']] as const) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error }, { status }));
    await assert.rejects(client.turn(app, 'Add charts', 'key'), cause =>
      cause instanceof BuildAPIError && cause.code === error && cause.message === buildErrorMessage(error));
    t.mock.restoreAll();
  }
  assert.doesNotMatch(buildErrorMessage('internal_database_error'), /internal_database_error/);
});

test('session expiry is reported for source reads and ZIP downloads', async t => {
  let signedOut = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'not_authenticated' }, { status: 401 }));
  const client = createBuildClient(() => { signedOut++; });
  await assert.rejects(client.source(app.id), BuildAPIError);
  await assert.rejects(client.export(app.id), BuildAPIError);
  assert.equal(signedOut, 2);
});

test('network failure and cancellation remain distinguishable without discarding the submission', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(createBuildClient(() => {}).create('An app', 'retry-key'), cause =>
    cause instanceof BuildAPIError && cause.code === 'network');
  const controller = new AbortController(); controller.abort();
  const cancelled = new DOMException('Request aborted', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw cancelled; });
  const client = createBuildClient(() => {}, controller.signal);
  await assert.rejects(client.list(), error => error === cancelled);
  await assert.rejects(client.export(app.id), error => error === cancelled);
});

test('source export preserves binary ZIP bytes and reports API failures', async t => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 255]);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'Content-Type': 'application/zip' } }));
  const client = createBuildClient(() => {});
  assert.deepEqual(new Uint8Array(await (await client.export(app.id)).arrayBuffer()), bytes);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'app_not_found' }, { status: 404 }));
  await assert.rejects(client.export(app.id), cause => cause instanceof BuildAPIError && cause.code === 'app_not_found');
});
