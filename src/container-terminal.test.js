import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Mock only browser/xterm boundaries; exercise the actual terminal client.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      '@xterm/xterm': 'export const Terminal = globalThis.TerminalMock;',
      '@xterm/addon-fit': 'export const FitAddon = globalThis.FitMock;',
      '@xterm/xterm/css/xterm.css': '',
      './auth.js': "export const API_ORIGIN = 'https://api.mainbrella.com';",
    };
    if (Object.hasOwn(mocks, specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
    return next(specifier, context);
  },
});
let term;
globalThis.TerminalMock = class {
  cols = 80;
  rows = 24;
  output = [];
  constructor() { term = this; }
  loadAddon() {}
  open() {}
  focus() {}
  reset() { this.resets = (this.resets ?? 0) + 1; }
  onData(callback) { this.input = callback; return { dispose() {} }; }
  write(data, callback) { this.output.push(data); callback(); }
  dispose() { this.disposed = true; }
};
globalThis.FitMock = class { fit() {} };
const { openContainerTerminal } = await import('./container-terminal.js');
hooks.deregister();

function fixture(t) {
  const sockets = [];
  const timers = new Map();
  let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const property = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  };
  property('matchMedia', () => ({ matches: true }));
  property('ResizeObserver', class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} });
  class Socket {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map();
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.emit('close', { code: 1000 }); }
    emit(type, event = {}) { this.listeners.get(type)?.(event); }
    ready() { this.readyState = 1; this.emit('message', { data: JSON.stringify({ type: 'ready' }) }); }
  }
  property('WebSocket', Socket);
  const status = { textContent: '' };
  const button = { listeners: new Map(), addEventListener(type, cb) { this.listeners.set(type, cb); }, removeEventListener(type) { this.listeners.delete(type); } };
  const output = { clientWidth: 600 };
  const host = { hidden: false, querySelector(selector) { return selector === '.terminal-output' ? output : selector === 'button' ? button : status; } };
  let closed = false;
  const client = openContainerTerminal(host, { createdAt: '2026-10-05T12:00:00.000Z', onClose: () => { closed = true; } });
  t.after(() => client.dispose());
  const fire = ms => {
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
  assert.equal(url.searchParams.get('createdAt'), '2026-10-05T12:00:00.000Z');
  assert.equal(url.searchParams.get('cols'), '80');
  assert.equal(url.searchParams.get('rows'), '24');
  socket.ready();
  term.input('echo café\n');
  assert.ok(socket.sent[1] instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(socket.sent[1]), 'echo café\n');
  socket.emit('message', { data: new TextEncoder().encode('hello').buffer });
  assert.equal(new TextDecoder().decode(term.output[0]), 'hello');
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'ack' });
  assert.equal(f.status.textContent, 'Connected');
});

test('abnormal disconnect uses bounded exponential retries with the original generation', t => {
  const f = fixture(t);
  f.sockets[0].ready();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    f.sockets.at(-1).emit('close', { code: 1006 });
    f.fire(delay);
    const socket = f.sockets.at(-1);
    assert.equal(new URL(socket.url).searchParams.get('createdAt'), '2026-10-05T12:00:00.000Z');
    socket.ready();
  }
  f.sockets.at(-1).emit('close', { code: 1006 });
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
