import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const source = await readFile(new URL('./cookie-consent.js', import.meta.url), 'utf8');
const consentKey = 'mainbrella-cookie-consent';

function visit({ local = new Map(), session = new Map(), blockedLocal = false, blockedSession = false } = {}) {
  const scripts = [];
  const cookieWrites = [];
  const listeners = new Map();
  const dialog = {
    open: false,
    addEventListener: (name, callback) => listeners.set(name, callback),
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const storage = (values, blocked) => ({
    getItem(key) { if (blocked) throw new Error('Storage blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage blocked'); values.set(key, value); },
  });
  const window = { localStorage: storage(local, blockedLocal), sessionStorage: storage(session, blockedSession) };
  const document = {
    querySelector: selector => selector === '#cookie-consent' ? dialog : { focus() {} },
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: tag => ({ tag }),
    head: { append: script => scripts.push(script.src) },
    set cookie(value) { cookieWrites.push(value); },
  };
  runInNewContext(source, { window, document });
  return { dialog, scripts, cookieWrites, window, local, session,
    choose(choice) { listeners.get('click')({ target: { closest: () => ({ dataset: { consent: choice } }) } }); },
  };
}

test('first visit and Reject All never load trackers or write cookies, including after reload', () => {
  const first = visit();
  assert.equal(first.dialog.open, true);
  assert.deepEqual(first.scripts, []);
  first.choose('rejected');
  assert.equal(first.dialog.open, false);
  assert.equal(first.local.get(consentKey), 'rejected');
  assert.deepEqual(first.scripts, []);
  assert.deepEqual(first.cookieWrites, []);
  assert.equal(first.window.gtag, undefined);
  assert.equal(first.window.oaiq, undefined);
  const returning = visit({ local: first.local });
  assert.equal(returning.dialog.open, false);
  assert.deepEqual(returning.scripts, []);
  assert.deepEqual(returning.cookieWrites, []);
});

for (const blockedSession of [false, true]) {
  test(`Reject All stays cookie-free with local storage blocked and session storage ${blockedSession ? 'blocked' : 'available'}`, () => {
    const first = visit({ blockedLocal: true, blockedSession });
    first.choose('rejected');
    assert.equal(first.dialog.open, false);
    assert.deepEqual(first.scripts, []);
    assert.deepEqual(first.cookieWrites, []);
    if (!blockedSession) {
      const returning = visit({ blockedLocal: true, session: first.session });
      assert.equal(returning.dialog.open, false);
      assert.deepEqual(returning.scripts, []);
    }
  });
}

test('measurement scripts load only after explicit acceptance and on accepted return visits', () => {
  const first = visit();
  assert.deepEqual(first.scripts, []);
  first.choose('accepted');
  assert.equal(first.scripts.length, 2);
  assert.ok(first.scripts.some(url => url.startsWith('https://www.googletagmanager.com/')));
  assert.ok(first.scripts.some(url => url.startsWith('https://bzrcdn.openai.com/')));
  const returning = visit({ local: first.local });
  assert.equal(returning.dialog.open, false);
  assert.deepEqual(returning.scripts, first.scripts);
});

test('importing payment code does not inject Stripe before checkout opens', async t => {
  const scripts = [];
  for (const [name, value] of Object.entries({
    window: {},
    document: {
      querySelectorAll: () => [],
      createElement: () => ({ addEventListener() {} }),
      head: { appendChild: script => scripts.push(script.src) },
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  // Vite supports package directory imports; resolve the same real package for Node.
  const require = createRequire(import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@stripe/stripe-js/pure') {
        return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const { mountStripeEmbeddedCheckout } = await import('./payments/stripeEmbeddedCheckout.js');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scripts, []);
  const cleanup = mountStripeEmbeddedCheckout({
    container: { replaceChildren() {} },
    form: { addEventListener() {}, removeEventListener() {} },
    emailInput: { addEventListener() {}, removeEventListener() {} },
    submitButton: {}, statusElement: { dataset: {} },
    publishableKey: 'pk_test_cookie_regression', clientSecret: 'cs_test_cookie_regression',
  });
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^https:\/\/js\.stripe\.com\//);
  cleanup();
});
