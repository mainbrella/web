import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import type { RepositoryLaunch } from './repo-run-contract.ts';
import { parseRepoRunConfig } from './repo-run-config.ts';

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
  checked = false; scrollTop = 0; scrollHeight = 1200;
  listeners = new Map<string, (event: any) => unknown>();
  get valueAsNumber() { return Number(this.value); }
  addEventListener(name: string, callback: (event: any) => unknown) { this.listeners.set(name, callback); }
  setCustomValidity(message: string) { this.validity = message; }
  reportValidity() { return !this.validity; }
  focus() { this.focused = true; }
  select() { this.selected = true; this.selectionStart = 0; this.selectionEnd = this.value.length; }
  setAttribute(name: string, value: string) { this[name] = value; }
  async fire(name: string, event: any = { preventDefault() {} }) {
    if (!this.disabled) { await this.listeners.get(name)?.(event); if (name === 'click') await this.onclick?.({ currentTarget: this }); }
  }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
type ExecutionRecord = { stdout?: string; stderr?: string; status?: string; exitCode?: number | null; timedOut?: boolean; outputTruncated?: boolean; startedAt?: string; cursor?: number };
async function fixture(t: TestContext, { search = '?repo=acme/demo&catalogId=node', hash = '', session = true, paid = true, billing = undefined as Record<string, number> | undefined, resolveError = '', state: initialState = null as RepositoryLaunch | null, stored = {} as Record<string, string>, executions: initialExecutions = {} as Record<string, ExecutionRecord | ExecutionRecord[]>, unavailableExecutions = [] as string[], executionGate: initialExecutionGate = null as Promise<void> | null, outputEvents = {} as Record<string, string | ReadableStream<Uint8Array>> } = {}) {
  const nodes = new Map<string, Element>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
  node('run-submit').textContent = 'Run repository';
  node('run-output-follow').checked = true;
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
  const storage = new Map(Object.entries(stored));
  property('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } });
  property('CustomEvent', class { constructor(public type: string, public options: any) {} get detail() { return this.options?.detail; } });
  property('window', { addEventListener: (name: string, callback: unknown) => events.set(name, callback), dispatchEvent: (event: any) => events.get(event.type)?.(event), requestAnimationFrame: (callback: () => void) => queueMicrotask(callback) });
  t.mock.method(globalThis, 'setTimeout', ((callback: () => unknown) => { timeouts.set(++timer, callback); return timer; }) as any);
  t.mock.method(globalThis, 'clearTimeout', ((id: number) => timeouts.delete(id)) as any);
  t.mock.method(globalThis, 'setInterval', ((callback: () => unknown) => { intervals.push(callback); return ++timer; }) as any);
  t.mock.method(globalThis, 'clearInterval', (() => {}) as any);
  let state = initialState;
  let failCreate = 0, failAdvance = false, previewFailure = false, setupFailure = false, gate: Promise<void> | null = null, advanceGate: Promise<void> | null = null, executionGate = initialExecutionGate;
  const executionCalls = new Map<string, number>();
  property('fetch', async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input); const body = options.body ? JSON.parse(options.body as string) : null;
    calls.push({ url, options, body });
    if (gate) await gate;
    if (url.pathname === '/containers') return Response.json({ active: paid, billing, limits: { maxStartsPerMonth: 1000 }, usage: { starts: 3 } });
    if (url.pathname === '/repo-launches/resolve') return resolveError ? Response.json({ error: resolveError }, { status: 503 }) : Response.json({ repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node' });
    if (url.pathname === '/repo-launches') {
      if (failCreate) { const status = failCreate; failCreate = 0; return Response.json({ error: status === 400 ? 'public_repo_not_found' : 'launch_unavailable' }, { status }); }
      state = { id: '12345678-1234-1234-1234-123456789abc', phase: 'allocating', options: body,
        repository: { repo: body.repo, ref: body.ref || 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
        container: null, executions: {}, createdAt: Date.now(), shellReadyAt: null, previewReadyAt: null, error: null };
    } else if (url.pathname.endsWith('/advance')) {
      if (advanceGate) await advanceGate;
      if (failAdvance) { failAdvance = false; return Response.json({ error: 'launch_unavailable' }, { status: 503 }); }
      if (state!.phase === 'allocating') { state!.phase = 'cloning'; state!.container = { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }; state!.executions = { cloning: 'clone-exec' }; }
      else if (state!.phase === 'cloning') { state!.shellReadyAt = Date.now(); state!.phase = state!.options.setupCommand ? 'setup' : state!.options.startCommand ? 'starting' : 'ready'; if (state!.options.setupCommand) state!.executions.setup = 'setup-exec'; else if (state!.options.startCommand) state!.executions.starting = 'start-exec'; }
      else if (state!.phase === 'setup') { state!.phase = setupFailure ? 'failed' : state!.options.startCommand ? 'starting' : 'ready'; if (state!.phase === 'starting') state!.executions.starting = 'start-exec'; state!.error = setupFailure ? 'setup_failed' : null; }
      else if (state!.phase === 'starting') { state!.phase = 'ready'; state!.previewReadyAt = Date.now(); }
    } else if (url.pathname.endsWith('/events')) {
      const id = url.pathname.split('/').at(-2)!;
      if (!outputEvents[id]) return Response.json({ error: 'execution_not_found' }, { status: 404 });
      return new Response(outputEvents[id], { headers: { 'content-type': 'text/event-stream' } });
    } else if (/^\/containers\/executions\//.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1)!;
      if (executionGate) await executionGate;
      if (unavailableExecutions.includes(id)) return Response.json({ error: 'execution_history_expired' }, { status: 404 });
      const configured = initialExecutions[id] ?? { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
      const index = executionCalls.get(id) ?? 0; executionCalls.set(id, index + 1);
      return Response.json(Array.isArray(configured) ? configured[Math.min(index, configured.length - 1)] : configured);
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
  return { node, calls, copied, location, terminals, events, intervals, storage, step, flush, state: () => state, executionCalls,
    failCreate(status: number) { failCreate = status; }, failAdvance() { failAdvance = true; }, failPreview() { previewFailure = true; }, failSetup() { setupFailure = true; }, setGate(value: Promise<void>) { gate = value; }, setAdvanceGate(value: Promise<void>) { advanceGate = value; }, setExecutionGate(value: Promise<void>) { executionGate = value; } };
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
  assert.equal(f.node('run-copy-step').hidden, true);
  assert.equal(f.node('run-import-step').hidden, true);
  assert.equal(f.node('run-prompt-copy').disabled, true);
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

test('try visitors without funds reach checkout before copying or importing AI setup', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo', paid: false });
  const checkout = new URL(f.location.href, f.location.origin);
  assert.equal(checkout.pathname, '/pricing/usage/');
  assert.equal(checkout.searchParams.get('repo'), 'acme/demo');
  assert.equal(checkout.searchParams.get('returnTo'), '/run/?repo=acme%2Fdemo&flow=try');
  assert.equal(f.node('run-form').hidden, true);
  assert.equal(f.copied.length, 0);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});

test('try sign-in preserves the selected repository and offer', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo&ref=feature%2Fa', session: false });
  const login = new URL(f.location.href, f.location.origin);
  assert.equal(login.pathname, '/login/');
  const destination = new URL(login.searchParams.get('returnTo')!, login.origin);
  assert.equal(destination.searchParams.get('flow'), 'try');
  assert.equal(destination.searchParams.get('repo'), 'acme/demo');
  assert.equal(destination.searchParams.get('ref'), 'feature/a');
  assert.equal(f.calls.length, 0);
});

test('active plan or trial access skips try checkout and explains the allowance', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo' });
  assert.equal(f.location.href, '');
  assert.equal(f.node('run-form').hidden, false);
  assert.equal(f.node('run-copy-step').hidden, false);
  assert.match(f.node('run-funding-note').textContent, /active plan or trial/);
  assert.equal(f.calls.some(call => call.url.pathname === '/repo-launches'), false);
});

test('try checkout uses available funds rather than a fully reserved wallet', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo', billing: { balanceCents: 500, availableBalanceCents: 0 } });
  assert.equal(new URL(f.location.href, f.location.origin).pathname, '/pricing/usage/');
  assert.equal(f.calls.some(call => (call.options.method ?? 'GET') !== 'GET'), false);
});

test('repository access failures show a retry rather than opening try checkout', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo', paid: false, resolveError: 'github_connection_required' });
  assert.equal(f.location.href, '');
  assert.equal(f.node('run-github').hidden, false);
  assert.equal(f.node('run-access-retry').hidden, false);
  assert.equal(f.calls.some(call => (call.options.method ?? 'GET') !== 'GET'), false);
});

test('prepare-first visitors can review setup with a funding action beside launch', async t => {
  const f = await fixture(t, { search: '?flow=try&repo=acme/demo&prepare=1&catalogId=node', paid: false });
  assert.equal(f.location.href, '');
  assert.equal(f.node('run-form').hidden, false);
  assert.equal(f.node('run-submit').hidden, true);
  assert.equal(f.node('run-fund').hidden, false);
  const checkout = new URL(f.node('run-fund').href, f.location.origin);
  assert.equal(new URL(checkout.searchParams.get('returnTo')!, f.location.origin).searchParams.has('prepare'), false);
});
test('explicit Run records private identity, resumes phases and copies only commit-pinned YAML', async t => {
  const f = await fixture(t); assert.equal(f.node('run-submit').disabled, false);
  assert.equal(f.node('run-submit').formNoValidate, false);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.location.hash, /^#launch=/); assert.equal(f.node('run-form').hidden, true);
  await f.step(); assert.equal(f.node('run-phase').textContent, 'Repository ready.'); assert.equal(f.terminals.length, 1);
  await f.node('run-active-share').fire('click');
  assert.match(f.copied[0], /ref: a{40}/);
  assert.deepEqual(parseRepoRunConfig(f.copied[0]), { repo: 'acme/demo', size: 'small', cwd: '.', catalogId: 'node', ref: 'a'.repeat(40) });
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
  assert.match(f.node('run-error').textContent, /may be private/);
});
test('setup failure keeps the terminal and visible output without replaying setup', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=exit+1' }); f.failSetup();
  await f.node('run-form').fire('submit'); await f.flush(); await f.step(); await f.step();
  assert.equal(f.node('run-phase').textContent, 'Launch needs attention.'); assert.equal(f.node('run-logs').hidden, false);
  assert.equal(f.terminals.length, 1); assert.equal(f.node('run-terminal').hidden, false);
  assert.match(f.node('run-phase-detail').textContent, /Setup failed/);
  assert.match(f.node('run-phase-detail').textContent, /No preview link will arrive/);
  assert.equal(f.node('run-help').hidden, false);
  await f.node('run-help-copy').fire('click'); await f.flush();
  assert.match(f.copied[0], /"launchId": "12345678-1234-1234-1234-123456789abc"/);
  assert.match(f.copied[0], /"createdAt": "2026-10-08T12:00:00.000Z"/);
  assert.match(f.copied[0], /do not allocate another/);
});
test('setup timeout is reported outside the output before the launcher confirms failure', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=npm+install', executions: { 'setup-exec': { status: 'failed', timedOut: true, exitCode: null, stdout: '', stderr: '' } } }); f.failSetup();
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  assert.equal(f.state()!.phase, 'setup');
  assert.equal(f.node('run-phase').textContent, 'Setup timed out after 15 minutes');
  assert.match(f.node('run-phase-detail').textContent, /No preview link will arrive/);
  assert.equal(f.node('run-logs').hidden, false);
  await f.step();
  assert.match(f.node('run-log-output').value, /Setup timed out after 15 minutes · exit code unknown/);
  assert.match(f.node('run-phase-detail').textContent, /Setup timed out after 15 minutes · exit code unknown/);
  assert.doesNotMatch(f.node('run-phase-detail').textContent, /stderr/);
});
test('nonzero exit reports failure while stderr warnings with exit code zero remain successful', async t => {
  const failed = await fixture(t, { search: '?repo=acme/demo&setupCommand=npm+run+build', executions: { 'setup-exec': { status: 'failed', exitCode: 7, stdout: '', stderr: 'compiler failed' } } }); failed.failSetup();
  await failed.node('run-form').fire('submit'); await failed.flush(); await failed.step(); await failed.step();
  assert.match(failed.node('run-log-output').value, /Setup failed · exit code 7/);
  assert.match(failed.node('run-phase-detail').textContent, /Setup failed · exit code 7/);
  assert.match(failed.node('run-help-text').value, /"status": "failed"/);
  assert.match(failed.node('run-help-text').value, /"exitCode": 7/);
  assert.doesNotMatch(failed.node('run-help-text').value, /compiler failed/);

  const warning = await fixture(t, { search: '?repo=acme/demo&setupCommand=npm+install', executions: { 'setup-exec': { status: 'succeeded', exitCode: 0, stdout: 'installed', stderr: 'deprecated package warning' } } });
  await warning.node('run-form').fire('submit'); await warning.flush(); await warning.step();
  assert.match(warning.node('run-log-output').value, /exit code 0/);
  assert.match(warning.node('run-log-output').value, /stderr:\ndeprecated package warning/);
  assert.doesNotMatch(warning.node('run-error').textContent, /Setup failed/);
});
test('interrupted and canceled executions are named without requiring output', async t => {
  for (const [status, expected] of [['interrupted', 'Setup was interrupted'], ['canceled', 'Setup was canceled']] as const) {
    const f = await fixture(t, { hash: '#launch=12345678-1234-1234-1234-123456789abc', state: {
      id: '12345678-1234-1234-1234-123456789abc', phase: 'failed', options: { repo: 'acme/demo', size: 'small', cwd: '.', setupCommand: 'npm install' },
      repository: { repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
      container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' },
      executions: { setup: 'setup-exec' }, createdAt: Date.now(), shellReadyAt: Date.now(), previewReadyAt: null, error: 'setup_failed',
    }, executions: { 'setup-exec': { status, exitCode: null, stdout: '', stderr: '' } } });
    assert.match(f.node('run-log-output').value, new RegExp(`${expected} · exit code unknown`));
    assert.match(f.node('run-phase-detail').textContent, new RegExp(expected));
  }
});
test('output truncation is warned and cloning and starting timeouts use their own phase limits', async t => {
  const truncated = await fixture(t, { search: '?repo=acme/demo&setupCommand=npm+install', executions: { 'setup-exec': { status: 'output_limit', exitCode: 0, outputTruncated: true, stdout: 'partial', stderr: '' } } });
  await truncated.node('run-form').fire('submit'); await truncated.flush(); await truncated.step();
  assert.match(truncated.node('run-log-output').value, /Setup reached the output limit · exit code 0/);
  assert.match(truncated.node('run-log-output').value, /Warning: output was truncated/);

  const cloning = await fixture(t, { executions: { 'clone-exec': { status: 'failed', timedOut: true, exitCode: null } } });
  await cloning.node('run-form').fire('submit'); await cloning.flush();
  cloning.intervals[1](); await cloning.flush();
  assert.match(cloning.node('run-log-output').value, /Repository clone timed out after 5 minutes · exit code unknown/);

  const starting = await fixture(t, { search: '?repo=acme/demo&startCommand=npm+start&port=3000', executions: { 'start-exec': { status: 'failed', timedOut: true, exitCode: null } } });
  await starting.node('run-form').fire('submit'); await starting.flush(); await starting.step(); await starting.step();
  starting.intervals[1](); await starting.flush();
  assert.match(starting.node('run-log-output').value, /App startup timed out after 4 minutes · exit code unknown/);
});
test('expired execution output leaves a clear fallback in the output panel', async t => {
  const f = await fixture(t, { hash: '#launch=12345678-1234-1234-1234-123456789abc', state: {
    id: '12345678-1234-1234-1234-123456789abc', phase: 'failed', options: { repo: 'acme/demo', size: 'small', cwd: '.' },
    repository: { repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
    container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' },
    executions: { cloning: 'clone-exec' }, createdAt: Date.now(), shellReadyAt: null, previewReadyAt: null, error: 'cloning_failed',
  }, unavailableExecutions: ['clone-exec'] });
  f.intervals[1](); await f.flush();
  assert.match(f.node('run-log-output').value, /cloning · Output unavailable or expired/);
});
test('running execution diagnostics refresh until terminal results are cached', async t => {
  const f = await fixture(t, { hash: '#launch=12345678-1234-1234-1234-123456789abc', state: {
    id: '12345678-1234-1234-1234-123456789abc', phase: 'failed', options: { repo: 'acme/demo', size: 'small', cwd: '.', setupCommand: 'npm install' },
    repository: { repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
    container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' },
    executions: { setup: 'setup-exec' }, createdAt: Date.now(), shellReadyAt: Date.now(), previewReadyAt: null, error: 'setup_failed',
  }, executions: { 'setup-exec': [
    { status: 'running', exitCode: null, stdout: 'still working', stderr: '' },
    { status: 'completed', exitCode: 0, stdout: 'finished', stderr: '' },
  ] } });
  assert.match(f.node('run-log-output').value, /still working/);
  assert.equal(f.executionCalls.get('setup-exec'), 1);
  f.intervals[1](); await f.flush();
  assert.match(f.node('run-log-output').value, /finished/);
  assert.equal(f.executionCalls.get('setup-exec'), 2);
  f.intervals[1](); await f.flush();
  assert.equal(f.executionCalls.get('setup-exec'), 2);
});
test('signing out while execution diagnostics are pending discards the private response', async t => {
  let release!: () => void;
  const executionGate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, { hash: '#launch=12345678-1234-1234-1234-123456789abc', executionGate, state: {
    id: '12345678-1234-1234-1234-123456789abc', phase: 'failed', options: { repo: 'acme/demo', size: 'small', cwd: '.', setupCommand: 'npm install' },
    repository: { repo: 'acme/demo', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: [] },
    container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' },
    executions: { setup: 'setup-exec' }, createdAt: Date.now(), shellReadyAt: Date.now(), previewReadyAt: null, error: 'setup_failed',
  }, executions: { 'setup-exec': { status: 'failed', exitCode: 9, timedOut: false, outputTruncated: false, stdout: 'private output', stderr: '' } } });
  f.events.get('auth-change')?.();
  release(); await f.flush();
  assert.equal(f.node('run-log-output').value, '');
  assert.equal(f.node('run-help-text').value, '');
  assert.equal(f.executionCalls.get('setup-exec'), 1);
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
  await f.node('run-active-share').fire('click');
  const config = parseRepoRunConfig(f.copied[0]);
  assert.equal(config.startCommand, 'npm start'); assert.equal(config.ref, state.repository.commit);
  assert.equal('id' in config, false); assert.equal('container' in config, false);
});

test('partial preview issuance reconciles the returned grant ID before reissuing', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&startCommand=npm+start&port=3000' }); f.failPreview();
  await f.node('run-form').fire('submit'); await f.flush(); await f.step(); await f.step();
  assert.equal(f.node('run-preview-open').hidden, true);
  assert.equal(f.node('run-phase').textContent, 'App ready. Preview link needs attention.');
  assert.match(f.node('run-phase-detail').textContent, /link creation failed/);
  await f.node('run-preview-create').fire('click'); await f.flush();
  const requests = f.calls.filter(call => call.url.pathname === '/containers/previews');
  assert.deepEqual(requests.map(call => call.options.method), ['GET', 'POST', 'DELETE', 'GET', 'POST']);
  assert.equal(requests[2].url.searchParams.get('previewId'), 'd'.repeat(32));
  assert.equal(f.node('run-preview-open').hidden, false);
  assert.equal(f.node('run-phase').textContent, 'App ready.');
});

test('live output follows the last line by default and lets the user read earlier output', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install', executions: { 'setup-exec': [
    { status: 'running', exitCode: null, stdout: 'first line\n', stderr: '' },
    { status: 'running', exitCode: null, stdout: 'first line\nsecond line\n', stderr: '' },
    { status: 'running', exitCode: null, stdout: 'first line\nsecond line\nlatest line\n', stderr: '' },
  ] } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  const output = f.node('run-log-output');
  assert.equal(output.scrollTop, output.scrollHeight);
  output.scrollTop = 0;
  f.intervals[1](); await f.flush();
  assert.match(output.value, /second line/);
  assert.equal(output.scrollTop, output.scrollHeight);
  f.node('run-output-follow').checked = false; output.scrollTop = 48;
  f.intervals[1](); await f.flush();
  assert.match(output.value, /latest line/); assert.equal(output.scrollTop, 48);
  f.node('run-output-follow').checked = true; await f.node('run-output-follow').fire('change');
  assert.equal(output.scrollTop, output.scrollHeight);
});

test('a quiet setup reports fresh checks and does not mistake silence for failure', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install&startCommand=serve&port=3000', executions: {
    'setup-exec': { status: 'running', exitCode: null, stdout: 'START system packages\nUnpacking libexample\n', stderr: '' },
  } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  assert.match(f.node('run-phase-detail').textContent, /Current stage: system packages/);
  assert.match(f.node('run-phase-detail').textContent, /Setup limit: 15 minutes/);
  assert.equal(f.node('run-terminal').hidden, true);
  now += 31_000; f.intervals[1](); await f.flush(); f.intervals[0]();
  assert.equal(f.node('run-phase').textContent, 'Setup is quiet; still checking.');
  assert.match(f.node('run-phase-detail').textContent, /Keep waiting/);
  assert.match(f.node('run-activity').textContent, /Result checked 0s ago/);
  assert.match(f.node('run-activity').textContent, /Output unchanged for 31s/);
  assert.equal(f.node('run-retry').hidden, true);
});

test('apt timeout exit code 124 is distinct from the outer setup deadline', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install&startCommand=serve&port=3000', executions: {
    'setup-exec': { status: 'failed', exitCode: 124, timedOut: false, stdout: 'Unpacking libexample\n', stderr: '' },
  } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  assert.equal(f.node('run-phase').textContent, 'Setup command reported a timeout');
  assert.match(f.node('run-phase-detail').textContent, /exit code 124/);
  assert.match(f.node('run-phase-detail').textContent, /No preview link will arrive/);
  assert.doesNotMatch(f.node('run-phase-detail').textContent, /after 15 minutes/);
  assert.equal(f.calls.some(call => call.url.pathname === '/containers/previews'), false);
});

test('progress request failure stops promises of a preview while output checks continue', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install&startCommand=serve&port=3000', executions: {
    'setup-exec': { status: 'running', exitCode: null, stdout: 'installing\n', stderr: '' },
  } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  f.failAdvance(); await f.step();
  assert.equal(f.node('run-phase').textContent, 'Progress checks paused.');
  assert.match(f.node('run-phase-detail').textContent, /Waiting alone will not produce a preview/);
  assert.equal(f.node('run-retry').hidden, false);
  const before = f.executionCalls.get('setup-exec')!;
  f.intervals[1](); await f.flush();
  assert.equal(f.executionCalls.get('setup-exec'), before + 1);
  assert.equal(f.node('run-phase').textContent, 'Progress checks paused.');
  await f.node('run-retry').fire('click'); await f.flush();
  assert.notEqual(f.node('run-phase').textContent, 'Progress checks paused.');
  assert.equal(f.calls.filter(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST').length, 1);
});

test('output checks run independently of a slow advance request', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install', executions: { 'setup-exec': [
    { status: 'running', exitCode: null, stdout: 'before\n', stderr: '' },
    { status: 'running', exitCode: null, stdout: 'before\nduring slow progress request\n', stderr: '' },
  ] } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  let release!: () => void;
  f.setAdvanceGate(new Promise<void>(resolve => { release = resolve; }));
  const advancing = f.step(); await f.flush();
  f.intervals[1](); await f.flush();
  assert.match(f.node('run-log-output').value, /during slow progress request/);
  release(); await advancing;
});

const sse = (type: string, value: unknown) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
test('stdout and stderr stream in sequence and reconnect by cursor without duplicated lines', async t => {
  const events = { 'setup-exec': sse('stdout', { sequence: 1, data: 'first\n' }) + sse('stderr', { sequence: 2, data: 'warning\n' }) + sse('stdout', { sequence: 3, data: 'latest\n' }) };
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install', outputEvents: events, executions: {
    'setup-exec': { status: 'running', exitCode: null, stdout: 'first\nlatest\n', stderr: 'warning\n', cursor: 3 },
  } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  assert.match(f.node('run-log-output').value, /first\nwarning\nlatest\n$/);
  events['setup-exec'] += sse('stdout', { sequence: 4, data: 'after reconnect\n' });
  f.intervals[1](); await f.flush();
  assert.match(f.node('run-log-output').value, /latest\nafter reconnect\n$/);
  assert.equal(f.node('run-log-output').value.split('first\n').length, 2);
  const streams = f.calls.filter(call => call.url.pathname.endsWith('/setup-exec/events'));
  assert.deepEqual(streams.map(call => call.url.searchParams.get('cursor')), ['0', '3']);
});

test('a terminal stream status reports the output cap without waiting for advance', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install&startCommand=serve&port=3000', executions: {
    'setup-exec': { status: 'running', exitCode: null, stdout: '', stderr: '', cursor: 0 },
  }, outputEvents: { 'setup-exec': sse('stdout', { sequence: 1, data: 'Unpacking libexample\n' }) + sse('status', {
    status: 'output_limit', exitCode: null, timedOut: false, outputTruncated: true, cursor: 1,
  }) } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  assert.equal(f.state()!.phase, 'setup');
  assert.equal(f.node('run-phase').textContent, 'Setup reached the output limit');
  assert.match(f.node('run-phase-detail').textContent, /launcher stopped the command/);
  assert.match(f.node('run-phase-detail').textContent, /No preview link will arrive/);
  assert.match(f.node('run-log-output').value, /Unpacking libexample/);
});

test('a delayed running snapshot cannot overwrite a terminal stream result', async t => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const f = await fixture(t, { search: '?repo=acme/demo&setupCommand=install', outputEvents: { 'setup-exec': stream }, executions: {
    'setup-exec': { status: 'running', exitCode: null, stdout: '', stderr: '', cursor: 0 },
  } });
  await f.node('run-form').fire('submit'); await f.flush(); await f.step();
  let release!: () => void;
  f.setExecutionGate(new Promise<void>(resolve => { release = resolve; }));
  f.intervals[1](); await f.flush();
  controller.enqueue(new TextEncoder().encode(sse('stdout', { sequence: 1, data: 'last install line\n' }) + sse('status', {
    status: 'timed_out', exitCode: null, timedOut: true, outputTruncated: false, cursor: 1,
  })));
  controller.close(); await f.flush();
  assert.equal(f.node('run-phase').textContent, 'Setup timed out after 15 minutes');
  release(); await f.flush();
  assert.equal(f.node('run-phase').textContent, 'Setup timed out after 15 minutes');
  assert.match(f.node('run-log-output').value, /last install line/);
});

test('a repo URL alone lets signed-out users copy setup instructions without allocating or signing in', async t => {
  const f = await fixture(t, { session: false, search: '?repo=https%3A%2F%2Fgithub.com%2Fhappier-dev%2Fhappier' });
  assert.equal(f.node('run-submit').hidden, true);
  assert.equal(f.node('run-copy-step').hidden, false);
  assert.equal(f.node('run-import-step').hidden, true);
  assert.equal(f.node('run-submit').textContent, 'Run repository');
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.copied[0], /https:\/\/github.com\/happier-dev\/happier/);
  assert.equal(f.node('run-import-step').hidden, false);
  assert.equal(f.node('run-prompt-status').textContent, 'Paste into ChatGPT or Claude, then paste its response below.');
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
  assert.equal(f.copied.length, 0); assert.match(f.node('run-repo').validity, /GitHub URL/);
  f.node('run-repo').value = 'https://github.com/happier-dev/happier';
  await f.node('run-form').fire('input');
  t.mock.method(navigator.clipboard, 'writeText', async () => { throw new Error('denied'); });
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.node('run-prompt-preview').hidden, false);
  assert.equal(f.node('run-import-step').hidden, true);
  assert.equal(f.node('run-prompt-text').selected, true);
  assert.match(f.node('run-prompt-text').value, /happier-dev\/happier/);
  assert.match(f.node('run-prompt-status').textContent, /copy it and paste/);
  assert.equal(f.calls.length, 0);
  await f.node('run-prompt-text').fire('copy');
  assert.equal(f.node('run-import-step').hidden, false);
  assert.equal(f.node('run-prompt-preview').hidden, true);
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

test('pasting a valid GitHub URL reveals the prompt without copying or making requests', async t => {
  const f = await fixture(t, { session: false, search: '' });
  const html = await readFile(new URL('../run/index.html', import.meta.url), 'utf8');
  f.node('run-repo').value = 'https://github.com/happier-dev/happier';
  await f.node('run-form').fire('input', { target: f.node('run-repo'), inputType: 'insertFromPaste' });
  assert.equal(f.node('run-fields').hidden, false);
  assert.equal(f.node('run-prompt-preview').hidden, false);
  assert.match(html, /<label id="run-prompt-preview"/);
  assert.doesNotMatch(html, /<details id="run-prompt-preview"/);
  assert.match(f.node('run-prompt-text').value, /https:\/\/github.com\/happier-dev\/happier/);
  assert.equal(f.node('run-copy-step').hidden, false);
  assert.equal(f.node('run-import-step').hidden, true);
  assert.equal(f.node('run-prompt-copy').disabled, false);
  assert.equal(f.copied.length, 0); assert.equal(f.calls.length, 0);
  const prompt = f.node('run-prompt-text').value;
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.copied[0], prompt);
  assert.equal(f.node('run-import-step').hidden, false);
  assert.equal(f.node('run-prompt-preview').hidden, true);
  f.node('run-repo').value = 'octocat/Hello-World';
  await f.node('run-form').fire('input');
  assert.equal(f.node('run-prompt-preview').hidden, false);
  assert.equal(f.node('run-import-step').hidden, true);
});

test('a pending prompt copy cannot reveal step three after the repository changes', async t => {
  const f = await fixture(t, { search: '?repo=acme/demo' });
  let complete!: () => void;
  t.mock.method(navigator.clipboard, 'writeText', () => new Promise<void>(resolve => { complete = resolve; }));
  await f.node('run-form').fire('submit');
  f.node('run-repo').value = 'https://github.com/octocat/Hello-World';
  await f.node('run-form').fire('input');
  assert.equal(f.node('run-import-step').hidden, true);
  complete(); await f.flush();
  assert.equal(f.node('run-import-step').hidden, true);
});

test('invalid pasted text keeps the URL input available and copy hidden', async t => {
  const f = await fixture(t, { session: false, search: '' });
  f.node('run-repo').value = 'https://example.com/owner/repo';
  await f.node('run-form').fire('input', { target: f.node('run-repo'), inputType: 'insertFromPaste' });
  assert.equal(f.node('run-fields').hidden, false);
  assert.equal(f.node('run-copy-step').hidden, true);
  assert.equal(f.node('run-prompt-copy').disabled, true);
  assert.equal(f.copied.length, 0);
});

test('editing the visible URL updates the prompt and hides it for invalid input', async t => {
  const f = await fixture(t, { session: false, search: '?repo=acme/demo' });
  f.node('run-repo').value = 'https://github.com/octocat/Hello-World';
  await f.node('run-form').fire('input');
  assert.equal(f.node('run-fields').hidden, false);
  assert.match(f.node('run-prompt-text').value, /octocat\/Hello-World/);
  f.node('run-repo').value = '';
  await f.node('run-form').fire('input');
  assert.equal(f.node('run-prompt-text').value, '');
  assert.equal(f.node('run-prompt-preview').hidden, true);
  assert.equal(f.node('run-copy-step').hidden, true);
  assert.equal(f.node('run-prompt-copy').disabled, true);
  assert.equal(f.node('run-import-step').hidden, true);
});

const importedConfig = { repo: 'happier-dev/happier', ref: 'e'.repeat(40), catalogId: 'node', size: 'large', cwd: 'apps/web',
  setupCommand: 'yarn install --frozen-lockfile && yarn build', startCommand: 'HOST=0.0.0.0 PORT=53005 yarn start', port: 53005 };
const draftId = '87654321-1234-1234-1234-123456789abc';
async function pasteConfig(f: Awaited<ReturnType<typeof fixture>>, text = JSON.stringify(importedConfig)) {
  f.node('run-import-text').value = text;
  await f.node('run-form').fire('input', { target: f.node('run-import-text') });
  await f.flush();
}

test('YAML AI response import reviews commands and sends the same JSON only after explicit Run', async t => {
  const f = await fixture(t, { search: '' });
  const expected = { ...importedConfig,
    setupCommand: 'set -euo pipefail\nyarn install --frozen-lockfile\nyarn build',
    startCommand: 'set -euo pipefail\nexport HOST=0.0.0.0\nexport PORT=53005\nexec yarn start' };
  const yaml = `repo: ${expected.repo}\nref: ${expected.ref}\ncatalogId: ${expected.catalogId}\nsize: ${expected.size}\ncwd: ${expected.cwd}\nsetupCommand: |-\n  ${expected.setupCommand.replaceAll('\n', '\n  ')}\nstartCommand: |-\n  ${expected.startCommand.replaceAll('\n', '\n  ')}\nport: 53005`;
  await pasteConfig(f, `Here is the recipe:\n\`\`\`yaml\n${yaml}\n\`\`\`\nSource-only verification.`);
  assert.equal(f.node('run-repo').value, importedConfig.repo);
  assert.equal(f.node('run-submit').hidden, false); assert.equal(f.node('run-submit').disabled, false);
  assert.match(f.node('run-config').textContent, /Runtime: node · Size: large/);
  assert.ok(f.node('run-config').textContent.includes(expected.setupCommand));
  assert.ok(f.node('run-config').textContent.includes(expected.startCommand));
  assert.equal(f.node('run-import-text')['aria-invalid'], 'false');
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
  assert.equal(f.location.search, ''); assert.match(f.location.hash, /^#config=/);
  await f.node('run-form').fire('submit'); await f.flush();
  const request = f.calls.find(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST')!;
  assert.deepEqual(request.body, expected);
  assert.equal(f.location.search, ''); assert.match(f.location.hash, /^#launch=/);
});

test('signed-out import survives login in same-tab storage with a short return URL', async t => {
  const f = await fixture(t, { search: '', session: false });
  await pasteConfig(f);
  assert.equal(f.calls.length, 0);
  assert.equal(f.node('run-submit').disabled, false);
  const id = f.location.hash.slice('#config='.length);
  assert.deepEqual(JSON.parse(f.storage.get(`mainbrella:repo-run:${id}`)!), importedConfig);
  const login = new URL(f.node('run-sign-in').href, f.location.origin);
  assert.equal(login.searchParams.get('returnTo'), `/run/#config=${id}`);
  await f.node('run-form').fire('submit'); await f.flush();
  assert.equal(f.location.href, f.node('run-sign-in').href);
  assert.equal(f.calls.length, 0);
});

test('returning from sign-in restores the imported configuration without launching', async t => {
  const f = await fixture(t, { search: '', hash: `#config=${draftId}`, stored: { [`mainbrella:repo-run:${draftId}`]: JSON.stringify(importedConfig) } });
  assert.equal(f.node('run-repo').value, importedConfig.repo);
  assert.match(f.node('run-import-text').value, /setupCommand: \|-\n/);
  assert.match(f.node('run-import-text').value, /startCommand: \|-\n/);
  assert.deepEqual(parseRepoRunConfig(f.node('run-import-text').value), importedConfig);
  assert.equal(f.node('run-submit').hidden, false);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});

test('invalid or ambiguous edits clear the previous review and launch action', async t => {
  const f = await fixture(t, { search: '' }); await pasteConfig(f);
  for (const text of ['{"repo":"acme/demo","port":"3000"}', `${JSON.stringify(importedConfig)}\n${JSON.stringify(importedConfig)}`, '']) {
    await pasteConfig(f, text);
    assert.equal(f.node('run-submit').hidden, true); assert.equal(f.node('run-config').hidden, true);
    assert.equal(f.node('run-repo').readOnly, false);
    assert.equal(f.node('run-import-text')['aria-invalid'], String(Boolean(text)));
  }
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});

test('an uncertain JSON submission retains the same payload and key on retry', async t => {
  const f = await fixture(t, { search: '' }); await pasteConfig(f); f.failCreate(503);
  await f.node('run-form').fire('submit'); await f.flush();
  const id = f.location.hash.slice('#request='.length);
  assert.deepEqual(JSON.parse(f.storage.get(`mainbrella:repo-run:${id}`)!), importedConfig);
  assert.equal(f.node('run-fields').disabled, true);
  await f.node('run-form').fire('submit'); await f.flush();
  const calls = f.calls.filter(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST');
  assert.equal((calls[0].options.headers as Record<string, string>)['Idempotency-Key'], (calls[1].options.headers as Record<string, string>)['Idempotency-Key']);
  assert.deepEqual(calls[0].body, importedConfig); assert.deepEqual(calls[1].body, importedConfig);
});

test('reloading a JSON request restores its payload and requires explicit Resume', async t => {
  const f = await fixture(t, { search: '', hash: `#request=${draftId}`, stored: { [`mainbrella:repo-run:${draftId}`]: JSON.stringify(importedConfig) } });
  assert.equal(f.node('run-fields').disabled, true); assert.equal(f.node('run-submit').textContent, 'Resume launch');
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
  await f.node('run-form').fire('submit'); await f.flush();
  const call = f.calls.find(call => call.url.pathname === '/repo-launches' && call.options.method === 'POST')!;
  assert.deepEqual(call.body, importedConfig);
  assert.equal((call.options.headers as Record<string, string>)['Idempotency-Key'], draftId);
});

test('a draft URL without same-tab storage asks for reimport', async t => {
  const f = await fixture(t, { search: '', hash: `#config=${draftId}` });
  assert.equal(f.node('run-submit').hidden, true); assert.equal(f.node('run-import-step').hidden, false);
  assert.match(f.node('run-import-status').textContent, /unavailable in this tab/);
  assert.equal(f.calls.length, 0);
  await pasteConfig(f); assert.equal(f.node('run-submit').hidden, false);
});

test('missing request storage cannot send a replacement payload with the pending key', async t => {
  const f = await fixture(t, { search: '', hash: `#request=${draftId}` });
  await f.node('run-form').fire('submit'); await f.flush();
  assert.match(f.node('run-error').textContent, /original tab/);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});

test('blocked browser storage prevents accepting an import and preserves the pasted text', async t => {
  const f = await fixture(t, { search: '' });
  t.mock.method(sessionStorage, 'setItem', () => { throw new Error('blocked'); });
  await pasteConfig(f);
  assert.match(f.node('run-import-status').textContent, /Allow browser storage/);
  assert.equal(f.node('run-submit').hidden, true);
  assert.equal(f.node('run-import-text').value, JSON.stringify(importedConfig));
  assert.equal(f.calls.length, 0);
});

test('unpaid users can import and review JSON but cannot run it', async t => {
  const f = await fixture(t, { search: '', paid: false }); await pasteConfig(f);
  assert.equal(f.node('run-submit').disabled, true); assert.equal(f.node('run-config').hidden, false);
  assert.equal(f.node('run-plans').hidden, false);
  assert.ok(f.calls.every(call => (call.options.method ?? 'GET') === 'GET'));
});
