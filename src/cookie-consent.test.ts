import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const preferences = await readFile(new URL('./cookie-preferences.ts', import.meta.url), 'utf8');
const modal = await readFile(new URL('./cookie-consent.ts', import.meta.url), 'utf8');
const source = transpileModule(preferences.replace(/^export /gm, '') + '\n' + modal.replace(/^import .*;\n/m, ''), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
const consentKey = 'mainbrella-cookie-consent';

function visit({ local = new Map(), session = new Map(), blockedLocal = false, blockedSession = false } = {}) {
  const scripts: string[] = [];
  const scriptElements: { src: string; id?: string; async?: boolean }[] = [];
  const cookieWrites: string[] = [];
  const listeners = new Map();
  const settingsListeners = new Map();
  const settings = { addEventListener: (name: string, callback: (...args: any[]) => unknown) => settingsListeners.set(name, callback), focus() {} };
  const dialog = {
    open: false,
    addEventListener: (name: string, callback: (...args: any[]) => unknown) => listeners.set(name, callback),
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const storage = (values: Map<string, string>, blocked: boolean) => ({
    getItem(key: string) { if (blocked) throw new Error('Storage blocked'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error('Storage blocked'); values.set(key, value); },
  });
  const window = { localStorage: storage(local, blockedLocal), sessionStorage: storage(session, blockedSession), dispatchEvent() {} };
  const document = {
    querySelector: (selector: string) => selector === '#cookie-consent' ? dialog : { focus() {} },
    querySelectorAll: () => [settings],
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: (tag: string) => ({ tag }),
    getElementById: (id: string) => scriptElements.find(script => script.id === id) ?? null,
    head: { append(script: { src: string; id?: string; async?: boolean }) { scripts.push(script.src); scriptElements.push(script); } },
    set cookie(value: string) { cookieWrites.push(value); },
  };
  const methods: { readConsent: () => string | null; needsSignInCookies: () => boolean } = runInNewContext(source + '\n({ readConsent, needsSignInCookies });', { window, document, CustomEvent: class { detail: unknown; constructor(public type: string, options: { detail: unknown }) { this.detail = options.detail; } } });
  return { ...methods, dialog, scripts, scriptElements, cookieWrites, window: window as typeof window & Pick<Window, "_tfa" | "gtag" | "oaiq">, local, session,
    reopen() { settingsListeners.get('click')(); },
    choose(choice: string) { listeners.get('click')({ target: { closest: () => ({ dataset: { consent: choice } }) } }); },
  };
}

test('first visit and Reject All never load trackers or write cookies, including after reload', () => {
  const first = visit();
  assert.equal(first.dialog.open, true);
  assert.deepEqual(first.scripts, [] as string[]);
  first.choose('rejected');
  assert.equal(first.dialog.open, false);
  assert.equal(first.local.get(consentKey), 'rejected');
  assert.deepEqual(first.scripts, [] as string[]);
  assert.deepEqual(first.cookieWrites, []);
  assert.equal(first.window.gtag, undefined);
  assert.equal(first.window.oaiq, undefined);
  assert.equal(first.window._tfa, undefined);
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
    assert.deepEqual(first.scripts, [] as string[]);
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
  assert.deepEqual(first.scripts, [] as string[]);
  first.choose('accepted');
  assert.equal(first.scripts.length, 3);
  assert.ok(first.scripts.some(url => url.startsWith('https://www.googletagmanager.com/')));
  assert.ok(first.scripts.some(url => url.startsWith('https://bzrcdn.openai.com/')));
  assert.ok(first.scripts.includes('https://cdn.taboola.com/libtrc/unip/2122717/tfa.js'));
  assert.deepEqual(JSON.parse(JSON.stringify(first.window._tfa)), [{ notify: 'event', name: 'page_view', id: 2122717 }]);
  const taboolaScript = first.scriptElements.find(script => script.id === 'tb_tfa_script');
  assert.equal(taboolaScript!.async, true);
  const returning = visit({ local: first.local });
  assert.equal(returning.dialog.open, false);
  assert.deepEqual(returning.scripts, first.scripts);
  assert.deepEqual(JSON.parse(JSON.stringify(returning.window._tfa)), [{ notify: 'event', name: 'page_view', id: 2122717 }]);
});

test('importing payment code does not inject Stripe before checkout opens', async t => {
  const scripts: string[] = [];
  for (const [name, value] of Object.entries({
    window: {},
    document: {
      querySelectorAll: () => [],
      createElement: () => ({ addEventListener() {} }),
      head: { appendChild: (script: { src: string }) => scripts.push(script.src) },
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
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
  const { mountStripeEmbeddedCheckout } = await import('./payments/stripeEmbeddedCheckout.ts');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scripts, []);
  const cleanup = mountStripeEmbeddedCheckout({
    container: { replaceChildren() {} } as unknown as HTMLElement,
    form: { addEventListener() {}, removeEventListener() {} } as unknown as HTMLFormElement,
    emailInput: { addEventListener() {}, removeEventListener() {} } as unknown as HTMLInputElement,
    submitButton: {} as HTMLButtonElement, statusElement: { dataset: {} } as HTMLElement,
    totalElement: {} as HTMLElement, submitLabel: "Subscribe",
    publishableKey: 'pk_test_cookie_regression', clientSecret: 'cs_test_cookie_regression',
  });
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^https:\/\/js\.stripe\.com\//);
  cleanup();
});


test('rejected visitors can reopen the original modal, reject again, or accept to enable login and pixels', () => {
  const first = visit();
  first.choose('rejected');
  const returning = visit({ local: first.local });
  assert.equal(returning.needsSignInCookies(), true);
  returning.reopen();
  assert.equal(returning.dialog.open, true);
  returning.choose('rejected');
  assert.equal(returning.needsSignInCookies(), true);
  assert.deepEqual(returning.scripts, []);
  returning.reopen();
  returning.choose('accepted');
  assert.equal(returning.needsSignInCookies(), false);
  assert.equal(returning.scripts.length, 3);
  returning.reopen();
  returning.choose('accepted');
  assert.equal(returning.scripts.length, 3);
  assert.equal(returning.window._tfa.length, 1);
});
