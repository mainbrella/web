import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { RepositoryLaunch } from './repo-run-contract.ts';

const hooks = registerHooks({ resolve(specifier, context, next) {
  const mocks: Record<string, string> = {
    './auth.ts': "export const API_ORIGIN = 'https://api.test'; export const createAuthClient = () => ({ readSession: () => globalThis.runSession() });",
    './container-terminal.ts': "export const openContainerTerminal = (host, options) => { globalThis.runTerminals.push(options); return { dispose: () => globalThis.runDisposed++ }; };",
  };
  return Object.hasOwn(mocks, specifier) ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
} });
process.on('exit', () => hooks.deregister());
await import('./container-terminal.ts');
let sequence = 0;
class Element {
  [key: string]: any;
  hidden = false; disabled = false; textContent = ''; value = ''; open = false; options = [{ textContent: 'Automatic' }]; validity = '';
  listeners = new Map<string, (event: any) => unknown>();
  get valueAsNumber() { return Number(this.value); }
  addEventListener(name: string, callback: (event: any) => unknown) { this.listeners.set(name, callback); }
  setCustomValidity(message: string) { this.validity = message; }
  reportValidity() { return !this.validity; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  async fire(name: string, event: any = { preventDefault() {} }) {
    if (!this.disabled) { await this.listeners.get(name)?.(event); if (name === 'click') await this.onclick?.({ currentTarget: this }); }
  }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t: TestContext, { search = '?repo=acme/demo&catalogId=node', hash = '', session = true, paid = true, state: initialState = null as RepositoryLaunch | null } = {}) {
  const nodes = new Map<string, Element>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
  node('run-submit').textContent = 'Run repository';
  for (const id of ['run-error', 'run-progress', 'run-terminal', 'run-preview', 'run-preview-open', 'run-retry', 'run-access']) node(id).hidden = true;
  const events = new Map(); const calls: { url: URL; options: RequestInit; body: any }[] = []; const copied: string[] = [];
  const timeouts = new Map<number, () => unknown>(); const intervals: (() => unknown)[] = []; let timer = 0;
  const location = { origin: 'https://mainbrella.com', pathname: '/run/', search, hash, href: '', reload() {} };
  const property = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  };
  property('runSession', async () => session ? { user: { id: 'owner' } } : null);
  const terminals: any[] = []; property('runTerminals', terminals); property('runDisposed', 0);
  property('document', { getElementById: node }); property('location', location);
  property('history', { replaceState(_data: unknown, _unused: string, value: URL) { location.search = value.search; location.hash = value.hash; } });
  property('navigator', { clipboard: { async writeText(value: string) { copied.push(value); } } });
  property('window', { addEventListener: (name: string, callback: unknown) => events.set(name, callback) });
  t.mock.method(globalThis, 'setTimeout', ((callback: () => unknown) => { timeouts.set(++timer, callback); return timer; }) as any);
  t.mock.method(globalThis, 'clearTimeout', ((id: number) => timeouts.delete(id)) as any);
  t.mock.method(globalThis, 'setInterval', ((callback: () => unknown) => { intervals.push(callback); return ++timer; }) as any);
  t.mock.method(globalThis, 'clearInterval', (() => {}) as any);
  let state = initialState;
  let failCreate = 0, previewFailure = false, setupFailure = false, gate: Promise<void> | null = null;
  property('fetch', async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input); const body = options.body ? JSON.parse(options.body as string) : null;
    calls.push({ url, options, body });
    if (gate) await gate;
    if (url.pathname === '/containers') return Response.json({ active: paid, limits: { maxStartsPerMonth: 1000 }, usage: { starts: 3 } });
    if (url.pathname === '/repo-launches/resolve') return Response.json({ repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node' });
    if (url.pathname === '/repo-launches') {
      if (failCreate) { const status = failCreate; failCreate = 0; return Response.json({ error: status === 400 ? 'public_repo_not_found' : 'launch_unavailable' }, { status }); }
      state = { id: '12345678-1234-1234-1234-123456789abc', phase: 'allocating', options: body,
        repository: { repo: body.repo, ref: body.ref || 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
        container: null, executions: {}, createdAt: Date.now(), shellReadyAt: null, previewReadyAt: null, error: null };
    } else if (url.pathname.endsWith('/advance')) {
      if (state!.phase === 'allocating') { state!.phase = 'cloning'; state!.container = { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }; }
      else if (state!.phase === 'cloning') { state!.shellReadyAt = Date.now(); state!.phase = state!.options.setupCommand ? 'setup' : state!.options.startCommand ? 'starting' : 'ready'; }
      else if (state!.phase === 'setup') { state!.phase = setupFailure ? 'failed' : state!.options.startCommand ? 'starting' : 'ready'; state!.error = setupFailure ? 'setup_failed' : null; }
      else if (state!.phase === 'starting') { state!.phase = 'ready'; state!.previewReadyAt = Date.now(); }
    } else if (url.pathname === '/containers/previews') {
      if (options.method === 'GET') return Response.json({ previews: [] });
      if (options.method === 'DELETE') return Response.json({ revoked: true });
      if (previewFailure) { previewFailure = false; return Response.json({ error: 'preview_reconciliation_required', previewId: 'd'.repeat(32) }, { status: 503 }); }
      return Response.json({ id: 'b'.repeat(32), port: 3000, createdAt: state!.container!.createdAt, expiresAt: Date.now() + 900000, url: `https://${'c'.repeat(48)}.mainbrella.dev/` });
    }
    return Response.json(state);
  });
  await import(`./repo-run.ts?test=${++sequence}`); await flush();
  t.after(() => events.get('pagehide')?.());
  const step = async () => { const first = timeouts.entries().next().value; if (first) { timeouts.delete(first[0]); await first[1](); await flush(); } };
  return { node, calls, copied, location, terminals, events, intervals, step, flush, state: () => state,
    failCreate(status: number) { failCreate = status; }, failPreview() { previewFailure = true; }, failSetup() { setupFailure = true; }, setGate(value: Promise<void>) { gate = value; } };
}

test('opening a shared repo link prepares settings without mutations and preserves settings through login', async t => {
  const f = await fixture(t, { session: false, search: '?repo=acme/demo&ref=feature%2Fa&startCommand=npm+start&port=3000' });
  assert.equal(f.calls.length, 0); assert.equal(f.node('run-submit').disabled, false); assert.equal(f.node('run-copy-step').hidden, true); assert.equal(f.node('run-repo').readOnly, true);
  const returnTo = new URL(f.node('run-sign-in').href, f.location.origin).searchParams.get('returnTo')!;
  assert.equal(new URL(returnTo, f.location.origin).searchParams.get('startCommand'), 'npm start');
  await f.node('run-form').fire('submit');
  const login = new URL(f.location.href, f.location.origin);
  assert.equal(login.pathname, '/login/');
  assert.equal(new URL(login.searchParams.get('returnTo')!, f.location.origin).searchParams.get('ref'), 'feature/a');
  assert.equal(f.calls.length, 0);
});
test('the initial page only offers copying and Enter validates the repository', async t => {
  const f = await fixture(t, { session: false, search: '' });
  assert.equal(f.node('run-submit').hidden, true);
  assert.equal(f.node('run-copy-step').hidden, false);
  assert.equal(f.node('run-access').hidden, true);
  assert.equal(f.node('run-allowance').hidden, true);
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.location.href, ''); assert.equal(f.copied.length, 0);
  assert.equal(f.calls.length, 0);
});
test('signed-in preparation and unpaid access never allocate', async t => {
  const f = await fixture(t, { paid: false });
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
  assert.equal(f.node('run-submit').disabled, true); assert.equal(f.node('run-plans').hidden, false);
});
test('explicit Run records private identity, resumes phases and shares only settings', async t => {
  const f = await fixture(t); assert.equal(f.node('run-submit').disabled, false);
  assert.equal(f.node('run-submit').formNoValidate, false);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.location.hash, /^#launch=/); assert.equal(f.node('run-form').hidden, true);
  await f.step(); assert.equal(f.node('run-phase').textContent, 'Repository ready.'); assert.equal(f.terminals.length, 1);
  await f.node('run-active-share').fire('click');
  const url = new URL(f.copied[0]); assert.equal(url.hash, ''); assert.equal(url.searchParams.get('repo'), 'acme/demo');
  assert.equal(f.calls.filter(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST').length, 1);
});
test('an uncertain submission locks settings and retries the same key and payload', async t => {
  const f = await fixture(t); f.failCreate(503);
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.location.hash, /^#request=/); assert.equal(f.node('run-fields').disabled, true); assert.equal(f.node('run-submit').textContent, 'Resume launch');
  await f.node('run-form').fire('submit'); await f.flush();
  const requests = f.calls.filter(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST');
  assert.equal((requests[0].options.headers as Record<string, string>)['Idempotency-Key'], (requests[1].options.headers as Record<string, string>)['Idempotency-Key']);
  assert.deepEqual(requests[0].body, requests[1].body);
});
test('definitive validation errors let users correct the launch before allocation', async t => {
  const f = await fixture(t); f.failCreate(400);
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.location.hash, ''); assert.equal(f.node('run-fields').disabled, false); assert.equal(f.node('run-submit').textContent, 'Run repository');
  assert.match(f.node('run-error').textContent, /Public repository not found/);
});
test('setup failure keeps an attached terminal and opens output without replaying setup', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=exit+1' }); f.failSetup();
  await f.node('run-form').fire('submit'); await f.flush(); await f.step(); await f.step();
  assert.equal(f.node('run-phase').textContent, 'Launch needs attention.'); assert.equal(f.node('run-logs').open, true);
  assert.equal(f.terminals.length, 1); assert.equal(f.node('run-terminal').hidden, false);
  assert.match(f.node('run-error').textContent, /Setup failed/);
  assert.equal(f.node('run-help').hidden, false);
  await f.node('run-help-copy').fire('click'); await f.flush();
  assert.match(f.copied[0], /"launchId": "12345678-1234-1234-1234-123456789abc"/);
  assert.match(f.copied[0], /"createdAt": "2026-10-08T12:00:00.000Z"/);
  assert.match(f.copied[0], /do not allocate another/);
});
test('preview issuance is limited to a newly started ready app and renewal stays explicit', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&startCommand=npm+start&port=3000' });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step(); await f.step();
  assert.equal(f.node('run-preview-open').hidden, false);
  assert.equal(f.calls.filter(call => call.url.pathname === '/containers/previews' && call.options.method === 'POST').length, 1);
  const expiry = Date.now; t.mock.method(Date, 'now', () => expiry() + 1000000); f.intervals[0]();
  assert.equal(f.node('run-preview-open').hidden, true); assert.match(f.node('run-preview-status').textContent, /expired/);
});
test('signing out during a pending launch discards private responses and does not advance', async t => {
  const f = await fixture(t); let release!: () => void; f.setGate(new Promise<void>(resolve => { release = resolve; }));
  await f.node('run-form').fire('submit'); f.events.get('auth-change')?.(); release(); await f.flush();
  assert.equal(f.node('run-progress').hidden, true); assert.equal(f.node('run-submit').disabled, false);
  assert.equal(f.calls.some(call => call.url.pathname.endsWith('/advance')), false);
  await f.node('run-form').fire('submit');
  assert.equal(new URL(f.location.href, f.location.origin).pathname, '/login/');
});

test('reloading an uncertain request requires an explicit Resume before sending any mutation', async t => {
  const f = await fixture(t, { hash: '#request=12345678-1234-1234-1234-123456789abc' });
  assert.equal(f.node('run-fields').disabled, true);
  assert.equal(f.node('run-submit').textContent, 'Resume launch');
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});
test('reloading a completed private run reattaches the shell and requires explicit preview renewal', async t => {
  const state: RepositoryLaunch = {
    id: '12345678-1234-1234-1234-123456789abc', phase: 'ready', options: { repo: 'acme/demo', size: 'small', cwd: '.', startCommand: 'npm start', port: 3000 },
    repository: { repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
    container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' },
    executions: {}, createdAt: Date.now(), shellReadyAt: Date.now(), previewReadyAt: Date.now(), error: null,
  };
  const f = await fixture(t, { hash: `#launch=${state.id}`, state });
  assert.equal(f.terminals.length, 1); assert.equal(f.node('run-preview-open').hidden, true);
  assert.equal(f.calls.some(call => call.url.pathname === '/repo-launches' || call.url.pathname === '/containers/previews'), false);
  await f.node('run-active-share').fire('click'); assert.equal(new URL(f.copied[0]).hash, '');
  assert.equal(new URL(f.copied[0]).searchParams.get('startCommand'), 'npm start');
});

test('partial preview issuance reconciles the returned grant ID before reissuing', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&startCommand=npm+start&port=3000' }); f.failPreview();
  await f.node('run-form').fire('submit'); await f.flush(); await f.step(); await f.step();
  assert.equal(f.node('run-preview-open').hidden, true);
  await f.node('run-preview-create').fire('click'); await f.flush();
  const requests = f.calls.filter(call => call.url.pathname === '/containers/previews');
  assert.deepEqual(requests.map(call => call.options.method), ['GET', 'POST', 'DELETE', 'GET', 'POST']);
  assert.equal(requests[2].url.searchParams.get('previewId'), 'd'.repeat(32));
  assert.equal(f.node('run-preview-open').hidden, false);
});

test('a repo URL alone lets signed-out users copy setup instructions without allocating or signing in', async t => {
  const f = await fixture(t, { session: false, search: '?repo=https%3A%2F%2Fgithub.com%2Fhappier-dev%2Fhappier' });
  assert.equal(f.node('run-submit').hidden, true);
  assert.equal(f.node('run-copy-step').hidden, false);
  assert.equal(f.node('run-submit').textContent, 'Run repository');
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.copied[0], /https:\/\/github.com\/happier-dev\/happier/);
  assert.match(f.node('run-prompt-status').textContent, /Copied/);
  assert.equal(f.calls.length, 0); assert.equal(f.location.href, '');
});

test('copy remains available without paid access and uses the edited repository', async t => {
  const f = await fixture(t, { paid: false, search: '?repo=acme/demo' });
  f.node('run-repo').value = 'happier-dev/happier';
  await f.node('run-form').fire('input');
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.copied[0], /happier-dev\/happier/);
  assert.equal(f.calls.length, 0);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});

test('copy validates the repository and offers a selected fallback when clipboard access fails', async t => {
  const f = await fixture(t, { session: false, search: '' });
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.copied.length, 0); assert.match(f.node('run-repo').validity, /public GitHub/);
  f.node('run-repo').value = 'https://github.com/happier-dev/happier';
  await f.node('run-form').fire('input');
  t.mock.method(navigator.clipboard, 'writeText', async () => { throw new Error('denied'); });
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.node('run-prompt-fallback').hidden, false);
  assert.equal(f.node('run-prompt-text').selected, true);
  assert.match(f.node('run-prompt-text').value, /happier-dev\/happier/);
  assert.match(f.node('run-prompt-status').textContent, /copy it and paste/);
  assert.equal(f.calls.length, 0);
});

test('configured links show read-only commands and a single launch action', async t => {
  const f = await fixture(t, { search: '?repo=happier-dev/happier&setupCommand=yarn+build&startCommand=yarn+start&port=3005' });
  assert.equal(f.node('run-copy-step').hidden, true);
  assert.equal(f.node('run-repo').readOnly, true);
  assert.equal(f.node('run-submit').hidden, false);
  assert.equal(f.node('run-submit').textContent, 'Run repository');
  assert.match(f.node('run-config').textContent, /Setup: yarn build/);
  assert.match(f.node('run-config').textContent, /Preview port: 3005/);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});
