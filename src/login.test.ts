import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
// Partial DOM double; dynamic fields are set by the browser client.
class Element {
  [key: string]: any;
  hidden = true; disabled = false; textContent = ''; value = ''; dataset: Record<string, string> = {}; listeners = new Map(); attributes = new Map();
  classList = { add() {}, remove() {} };
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  removeEventListener(type: string) { this.listeners.delete(type); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  replaceChildren() {}
  reportValidity() { return true; }
  focus() {}
  remove() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  async fire(type: string, event: any = { preventDefault() {} }) { await this.listeners.get(type)?.(event); }
}

async function fixture(t: TestContext, { choice = '', profile = false, signedIn = false } = {}) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (profile && ['.email-login-form', '#login-email', '#login-password', '.email-login-submit'].includes(selector)) return null;
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const stored = new Map([['mainbrella-cookie-consent', choice]]);
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) };
  const calls: { path: string; options: RequestInit }[] = [];
  const scripts: string[] = [];
  const redirects: string[] = [];
  const events = new Map();
  const property = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  };
  const window: { google?: unknown; [key: string]: any } = {
    localStorage: storage, sessionStorage: storage,
    location: { hostname: 'mainbrella.com', origin: 'https://mainbrella.com', pathname: profile ? '/profile/' : '/login/',
      search: '?returnTo=%2Fpricing%2Fpro%2F', replace: (path: string) => redirects.push(path) },
    addEventListener(type: string, callback: (event: any) => unknown) { events.set(type, callback); },
    dispatchEvent(event: Event) { events.get(event.type)?.(event); },
  };
  property('window', window);
  property('location', window.location);
  property('document', {
    querySelector: (selector: string) => selector === 'script[data-google-identity]' ? null : node(selector),
    querySelectorAll: () => [node('[data-cookie-settings]')],
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: () => new Element(),
    getElementById: () => null,
    head: {
      append(script: Element) { scripts.push(script.src); },
      appendChild(script: Element) {
        scripts.push(script.src);
        if (script.src === 'https://accounts.google.com/gsi/client') {
          window.google = { accounts: { id: { initialize() {}, renderButton() {}, disableAutoSelect() {} } } };
          setImmediate(() => script.fire('load'));
        }
      },
    },
  });
  property('fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    if (path === '/auth/logout') return Response.json({ ok: true });
    return Response.json({ created: true, user: path === '/auth/me' && !signedIn ? null : { id: 'account', email: 'test@example.com' } });
  });
  await import(`./login.ts?test=${++sequence}`);
  await new Promise(resolve => setImmediate(resolve));
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  return { node: (selector: string) => node(selector)!, stored, calls, scripts, redirects, flush };
}

for (const choice of ['', 'accepted', 'rejected']) {
  test(`sign-in works with ${choice || 'no'} legacy consent without loading tracking`, async t => {
    const f = await fixture(t, { choice });
    assert.equal(f.node('.login-provider').hidden, false);
    assert.match(f.node('.login-status').textContent, /Continue with Google or email/);
    assert.deepEqual(f.calls.map(call => call.path), ['/auth/me']);
    assert.deepEqual(f.scripts, ['https://accounts.google.com/gsi/client']);
    f.node('#login-email').value = 'test@example.com';
    f.node('#login-password').value = 'password';
    await f.node('.email-login-form').fire('submit');
    assert.equal(f.calls.filter(call => call.path === '/auth/email').length, 1);
    assert.ok(f.calls.every(call => call.options.credentials === 'include'));
    assert.deepEqual(f.redirects, ['/pricing/pro/']);
    assert.deepEqual(f.scripts, ['https://accounts.google.com/gsi/client']);
  });
}

test('an existing profile session works after a legacy rejection without loading Google or trackers', async t => {
  const f = await fixture(t, { profile: true, signedIn: true, choice: 'rejected' });
  assert.equal(f.node('.login-signed-in').hidden, false);
  assert.equal(f.node('.profile-email').textContent, 'test@example.com');
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/me']);
  assert.deepEqual(f.scripts, []);
});

test('Google authentication and sign-out use only the essential session endpoints', async t => {
  const f = await fixture(t, { choice: 'rejected' });
  const { createAuthClient } = await import('./auth.ts');
  const auth = createAuthClient();
  await auth.signInWithGoogle('credential');
  await auth.signOut();
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/me', '/auth/google', '/auth/logout']);
  assert.ok(f.calls.every(call => call.options.credentials === 'include'));
  assert.deepEqual(f.scripts, ['https://accounts.google.com/gsi/client']);
});
