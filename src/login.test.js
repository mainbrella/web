import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
class Element {
  hidden = true; disabled = false; textContent = ''; value = ''; dataset = {}; listeners = new Map(); attributes = new Map();
  classList = { add() {}, remove() {} };
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  replaceChildren() {}
  reportValidity() { return true; }
  focus() {}
  remove() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  async fire(type, event = { preventDefault() {} }) { await this.listeners.get(type)?.(event); }
}

async function fixture(t, { choice = 'rejected', profile = false } = {}) {
  const nodes = new Map();
  const node = selector => {
    if (profile && ['.email-login-form', '#login-email', '#login-password', '.email-login-submit'].includes(selector)) return null;
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const stored = new Map([['mainbrella-cookie-consent', choice]]);
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const calls = [];
  const scripts = [];
  const redirects = [];
  const events = new Map();
  const property = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  };
  const window = {
    localStorage: storage, sessionStorage: storage,
    location: { hostname: 'mainbrella.com', origin: 'https://mainbrella.com', pathname: profile ? '/profile/' : '/login/',
      search: '?returnTo=%2Fpricing%2Fpro%2F', replace: path => redirects.push(path) },
    addEventListener(type, callback) { events.set(type, callback); },
    dispatchEvent(event) { events.get(event.type)?.(event); },
  };
  property('window', window);
  property('location', window.location);
  property('document', {
    querySelector: selector => selector === 'script[data-google-identity]' ? null : node(selector),
    querySelectorAll: () => [node('[data-cookie-settings]')],
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: () => new Element(),
    head: {
      append(script) { scripts.push(script.src); },
      appendChild(script) {
        scripts.push(script.src);
        if (script.src === 'https://accounts.google.com/gsi/client') {
          window.google = { accounts: { id: { initialize() {}, renderButton() {} } } };
          setImmediate(() => script.fire('load'));
        }
      },
    },
  });
  property('fetch', async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    return Response.json({ user: path === '/auth/me' ? null : { id: 'account', email: 'test@example.com' } });
  });
  // Give the actual modal a fresh DOM binding for each browser-page fixture.
  const { registerHooks } = await import('node:module');
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (specifier === './cookie-consent.js') return { ...result, url: result.url + '?login-test=' + sequence };
      return result;
    },
  });
  t.after(() => hooks.deregister());
  await import(`./login.js?test=${++sequence}`);
  await new Promise(resolve => setImmediate(resolve));
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  return { node, stored, calls, scripts, redirects, flush,
    async choose(nextChoice) {
      await node('#cookie-consent').fire('click', { target: { closest: () => ({ dataset: { consent: nextChoice } }) } });
      await flush();
    },
  };
}

test('rejection shows a login message without Google, tracking, or authenticated requests', async t => {
  const f = await fixture(t);
  assert.equal(f.node('.login-cookie-notice').hidden, false);
  assert.equal(f.node('.login-provider').hidden, true);
  assert.match(f.node('.login-status').textContent, /Change your cookie choice/);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.scripts, []);
  await f.node('.email-login-form').fire('submit');
  await f.node('.google-retry').fire('click');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.scripts, []);
  const { createAuthClient } = await import('./auth.js');
  await assert.rejects(createAuthClient().signInWithEmail('test@example.com', 'password'), /cookie choice/);
  await assert.rejects(createAuthClient().signInWithGoogle('credential'), /cookie choice/);
  assert.deepEqual(f.calls, []);
});

test('Change cookie choice reopens the two-choice modal and Accept All restores login and pixels', async t => {
  const f = await fixture(t);
  await f.node('[data-cookie-settings]').fire('click');
  assert.equal(f.node('#cookie-consent').open, true);
  await f.choose('rejected');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.scripts, []);
  await f.node('[data-cookie-settings]').fire('click');
  await f.choose('accepted');
  assert.equal(f.stored.get('mainbrella-cookie-consent'), 'accepted');
  assert.equal(f.node('.login-cookie-notice').hidden, true);
  assert.equal(f.node('.login-provider').hidden, false);
  assert.ok(f.scripts.some(url => url.startsWith('https://www.googletagmanager.com/')));
  assert.ok(f.scripts.some(url => url.startsWith('https://bzrcdn.openai.com/')));
  assert.ok(f.scripts.includes('https://accounts.google.com/gsi/client'));
  f.node('#login-email').value = 'test@example.com';
  f.node('#login-password').value = 'password';
  await f.node('.email-login-form').fire('submit');
  assert.equal(f.calls.filter(call => call.path === '/auth/email').length, 1);
  assert.deepEqual(f.redirects, ['/pricing/pro/']);
});

test('profile rejection offers the same recovery path without loading Google', async t => {
  const f = await fixture(t, { profile: true });
  assert.equal(f.node('.login-cookie-notice').hidden, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.scripts, []);
});

test('a direct first visit to login waits for the original cookie dialog before loading scripts', async t => {
  const f = await fixture(t, { choice: '' });
  assert.equal(f.node('#cookie-consent').open, true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.scripts, []);
  await f.choose('rejected');
  assert.equal(f.node('.login-cookie-notice').hidden, false);
  assert.deepEqual(f.scripts, []);
});
