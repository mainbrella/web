import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Mock only browser/xterm boundaries; exercise the actual terminal client.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const mocks: Record<string, string> = {
      '@xterm/xterm': 'export const Terminal = globalThis.TerminalMock;',
      '@xterm/addon-fit': 'export const FitAddon = globalThis.FitMock;',
      '@xterm/xterm/css/xterm.css': '',
      './auth.ts': "export const API_ORIGIN = 'https://api.mainbrella.com';",
    };
    if (Object.hasOwn(mocks, specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
    return next(specifier, context);
  },
});
let term: TerminalMock;
class TerminalMock {
  cols = 80;
  rows = 24;
  output: Uint8Array[] = [];
  resets = 0; disposed = false; input!: (data: string) => void;
  constructor() { term = this; }
  loadAddon() {}
  open() {}
  focus() {}
  reset() { this.resets = (this.resets ?? 0) + 1; }
  onData(callback: (data: string) => void) { this.input = callback; return { dispose() {} }; }
  write(data: Uint8Array, callback: () => void) { this.output.push(data); callback(); }
  dispose() { this.disposed = true; }
}
Object.assign(globalThis, { TerminalMock, FitMock: class { fit() {} } });
const { openContainerTerminal } = await import('./container-terminal.ts');
hooks.deregister();

function fixture(t: TestContext, container: { id?: string; createdAt: string } = { createdAt: '2026-10-05T12:00:00.000Z' }) {
  const sockets: Socket[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms: number) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; });
  t.mock.method(globalThis, 'clearTimeout', (id: number) => timers.delete(id));
  const property = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  };
  property('matchMedia', () => ({ matches: true }));
  property('ResizeObserver', class { constructor(public cb: () => void) {} observe() {} disconnect() {} });
  class Socket {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map();
    sent: (string | Uint8Array)[] = [];
    constructor(public url: string) { sockets.push(this); }
    addEventListener(type: string, callback: (event: unknown) => void) { this.listeners.set(type, callback); }
    send(value: string | Uint8Array) { this.sent.push(value); }
    close() { this.readyState = 3; this.emit('close', { code: 1000 }); }
    emit(type: string, event: unknown = {}) { this.listeners.get(type)?.(event); }
    ready() { this.readyState = 1; this.emit('message', { data: JSON.stringify({ type: 'ready' }) }); }
  }
  property('WebSocket', Socket);
  const status = { textContent: '' };
  const button = { listeners: new Map(), addEventListener(type: string, cb: () => void) { this.listeners.set(type, cb); }, removeEventListener(type: string) { this.listeners.delete(type); } };
  const output = { clientWidth: 600 };
  const host = { hidden: false, querySelector(selector: string) { return selector === '.terminal-output' ? output : selector === 'button' ? button : status; } };
  let closed = false;
  const client = openContainerTerminal(host as unknown as HTMLElement, { ...container, onClose: () => { closed = true; } });
  t.after(() => client.dispose());
  const fire = (ms: number) => {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `expected ${ms}ms timer`);
    timers.delete(entry[0]); entry[1].callback();
  };
  return { sockets, timers, status, button, host, client, fire, closed: () => closed };
}

test('browser client sends only its generation, dimensions and binary UTF-8, acknowledging raw output', t => {
  const f = fixture(t);
  const socket = f.sockets[0];
  const url = new URL(socket.url);
  assert.equal(url.origin, 'wss://api.mainbrella.com');
  assert.equal(url.pathname, '/containers/terminal');
  assert.equal((url as URL).searchParams.get('createdAt'), '2026-10-05T12:00:00.000Z');
  assert.equal((url as URL).searchParams.get('cols'), '80');
  assert.equal((url as URL).searchParams.get('rows'), '24');
  socket.ready();
  term.input('echo café\n');
  assert.ok(socket.sent[1] instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(socket.sent[1]), 'echo café\n');
  socket.emit('message', { data: new TextEncoder().encode('hello').buffer });
  assert.equal(new TextDecoder().decode(term.output[0]), 'hello');
  assert.deepEqual(JSON.parse(socket.sent.at(-1) as string), { type: 'ack' });
  assert.equal(f.status.textContent, 'Connected');
});

test('browser terminal scopes a container slot to its id and generation', t => {
  const f = fixture(t, { id: 'c2', createdAt: '2026-10-05T12:00:00.000Z' });
  const url = new URL(f.sockets[0].url);
  assert.equal((url as URL).searchParams.get('id'), 'c2');
  assert.equal((url as URL).searchParams.get('createdAt'), '2026-10-05T12:00:00.000Z');
});

test('abnormal disconnect uses bounded exponential retries with the original generation', t => {
  const f = fixture(t);
  f.sockets[0].ready();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    f.sockets.at(-1)!.emit('close', { code: 1006 });
    f.fire(delay);
    const socket = f.sockets.at(-1)!;
    assert.equal(new URL(socket.url).searchParams.get('createdAt'), '2026-10-05T12:00:00.000Z');
    socket.ready();
  }
  f.sockets.at(-1)!.emit('close', { code: 1006 });
  assert.equal(f.sockets.length, 6);
  assert.equal(f.timers.size, 0);
  assert.match(f.status.textContent, /Could not reconnect/);
});

test('clean container/session exit does not reconnect', t => {
  const f = fixture(t);
  const socket = f.sockets[0];
  socket.ready();
  socket.emit('message', { data: JSON.stringify({ type: 'exit', code: 0 }) });
  socket.emit('close', { code: 1000 });
  assert.equal(f.timers.size, 0);
  assert.equal(f.status.textContent, 'Shell exited (0).');
});

test('close cancels pending reconnects and releases terminal resources', t => {
  const f = fixture(t);
  f.sockets[0].emit('close', { code: 1006 });
  assert.equal(f.timers.size, 1);
  f.button.listeners.get('click')();
  assert.equal(f.timers.size, 0);
  assert.equal(term.disposed, true);
  assert.equal(f.host.hidden, true);
  assert.equal(f.closed(), true);
});
