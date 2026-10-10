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
  assert.equal(buildErrorMessage('unexpected_build_error'), 'Build error: unexpected_build_error');
});

test('failed builds include the actual command output with its line breaks', () => {
  const output = "failed\nsrc/App.tsx(12,5): error TS2304: Cannot find name 'total'.\nFix src/App.tsx.";
  assert.equal(buildErrorMessage('build_check_failed', output), `${buildErrorMessage('build_check_failed')}\n\n${output}`);
  assert.equal(buildErrorMessage('build_failed', '  '), buildErrorMessage('build_failed'));
  assert.equal(buildErrorMessage('build_failed', 'build_failed'), buildErrorMessage('build_failed'));
  for (const code of ['insufficient_balance', 'spend_limit_exceeded', 'build_inference_timeout', 'build_inference_disconnected', 'invalid_model_response']) {
    assert.doesNotMatch(buildErrorMessage(code), /Could not complete that action|Build error:/);
  }
});

test('action and export errors preserve backend messages, details and unfamiliar codes', async t => {
  const client = createBuildClient(() => {});
  const details = 'src/App.tsx: Missing export\nCheck the import on line 12.';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'provider_rate_limited', message: 'The model returned HTTP 429.', details }, { status: 429 }));
  for (const request of [() => client.create('An app', 'retry-key'), () => client.export(app.id)]) {
    await assert.rejects(request(), cause => cause instanceof BuildAPIError
      && cause.code === 'provider_rate_limited'
      && cause.message === `Build error: provider_rate_limited\n\nThe model returned HTTP 429.\n\n${details}`);
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'build_failed', message: details, details }, { status: 503 }));
  await assert.rejects(client.list(), cause => cause instanceof BuildAPIError
    && cause.message === `${buildErrorMessage('build_failed')}\n\n${details}`);
});

test('missing or malformed error responses retain a readable fallback', async t => {
  const client = createBuildClient(() => {});
  for (const response of [new Response('Bad gateway', { status: 502 }), Response.json({ error: {}, message: 123, details: [] }, { status: 503 })]) {
    t.mock.method(globalThis, 'fetch', async () => response.clone());
    for (const request of [() => client.list(), () => client.export(app.id)]) {
      await assert.rejects(request(), cause => cause instanceof BuildAPIError
        && cause.code === 'build_unavailable' && cause.message === buildErrorMessage('build_unavailable'));
    }
  }
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

test('diagnostics reads the authenticated turn journal and preserves API errors and cancellation', async t => {
  const appId = app.id, turnId = '67c16cc6-15d5-4ec8-9656-809314ec33c0';
  const diagnostics = { schemaVersion: 1, turnId, status: 'failed', error: 'build_check_failed', log: '', failureOperationId: 'compile-0', operations: [], billing: [] };
  const controller = new AbortController(), requests: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    requests.push({ url, options }); return Response.json(diagnostics);
  });
  const client = createBuildClient(() => assert.fail('no session expiry'), controller.signal);
  assert.deepEqual(await client.diagnostics(appId, turnId), diagnostics);
  assert.equal(requests[0].url, `http://localhost:8787/build/apps/${appId}/turns/${turnId}/diagnostics`);
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.signal, controller.signal);

  let signedOut = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'not_authenticated' }, { status: 401 }));
  await assert.rejects(createBuildClient(() => { signedOut++; }).diagnostics(appId, turnId), cause => cause instanceof BuildAPIError && cause.code === 'not_authenticated');
  assert.equal(signedOut, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'turn_not_found' }, { status: 404 }));
  await assert.rejects(client.diagnostics(appId, turnId), cause => cause instanceof BuildAPIError && cause.code === 'turn_not_found');
  controller.abort();
  const cancelled = new DOMException('Request aborted', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw cancelled; });
  await assert.rejects(client.diagnostics(appId, turnId), error => error === cancelled);
});

test('live progress uses the authenticated app stream and closes on cancellation or disconnect', t => {
  class Events {
    static instances: Events[] = [];
    listeners = new Map<string, (event: unknown) => void>();
    onerror: (() => void) | null = null;
    closed = false;
    constructor(public url: string, public options: EventSourceInit) { Events.instances.push(this); }
    addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
    close() { this.closed = true; }
    app(value: unknown) { this.listeners.get('app')?.({ data: JSON.stringify(value) }); }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  Object.defineProperty(globalThis, 'EventSource', { value: Events, configurable: true });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'EventSource', descriptor); else Reflect.deleteProperty(globalThis, 'EventSource'); });
  const controller = new AbortController(), received: BuildApp[] = [];
  let disconnected = 0;
  const client = createBuildClient(() => assert.fail('no extra submission'), controller.signal);
  const stop = client.watch(app.id, value => received.push(value), () => { disconnected++; });
  const events = Events.instances[0];
  assert.equal(events.url, `http://localhost:8787/build/apps/${app.id}/events`);
  assert.equal(events.options.withCredentials, true);
  events.app({ app: { ...app, turns: [] } });
  assert.equal(received.length, 1);
  controller.abort();
  assert.equal(events.closed, true);
  events.app({ app: { ...app, turns: [] } });
  assert.equal(received.length, 1); assert.equal(disconnected, 0);
  stop();
  const active = createBuildClient(() => {}).watch(app.id, value => received.push(value), () => { disconnected++; });
  Events.instances[1].app({ app: { ...app, id: 'wrong-app', turns: [] } });
  assert.equal(received.length, 1); assert.equal(disconnected, 1); assert.equal(Events.instances[1].closed, true);
  active();
  createBuildClient(() => {}).watch(app.id, () => {}, () => { disconnected++; });
  Events.instances[2].onerror?.();
  assert.equal(disconnected, 2); assert.equal(Events.instances[2].closed, true);
});


test('model and effort are carried on paid build requests but not preview requests', async t => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(options.body as string)); return Response.json({ app });
  });
  const client = createBuildClient(() => {}), settings = { model: '@cf/zai-org/glm-5.3', effort: 'max' };
  await client.create('A tracker', 'new', settings);
  await client.turn(app, 'Add charts', 'change', settings);
  await client.preview(app, 'preview');
  assert.deepEqual(bodies, [{ prompt: 'A tracker', ...settings }, { mode: 'build', prompt: 'Add charts', revision: 3, ...settings }, { mode: 'preview', revision: 3 }]);
});
