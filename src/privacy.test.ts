import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import config from '../vite.config.ts';
import builderConfig from '../vite.builder.config.ts';
import { siteChromePlugin } from '../scripts/site-chrome-plugin.ts';

const cleanup = transpileModule((await readFile(new URL('./privacy.ts', import.meta.url), 'utf8')).replace('export {};', ''), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
}).outputText;

test('all site and builder entries render without consent controls or browser tracking', async () => {
  const hook = siteChromePlugin().transformIndexHtml;
  assert.ok(hook && typeof hook === 'object' && 'handler' in hook);
  const pluginContext = {} as ThisParameterType<typeof hook.handler>;
  const inputs = config({ command: 'build', mode: 'production' }).build?.rollupOptions?.input as Record<string, string>;
  assert.ok(Object.keys(inputs).length > 0);
  for (const filename of [...Object.values(inputs), builderConfig.build?.rollupOptions?.input as string]) {
    const path = '/' + filename.slice(new URL('..', import.meta.url).pathname.length);
    const html: unknown = await hook.handler.call(pluginContext, await readFile(filename, 'utf8'), { path, filename });
    assert.equal(typeof html, 'string');
    if (typeof html !== 'string') throw new Error('Expected rendered HTML');
    assert.doesNotMatch(html, /cookie-consent|data-cookie-settings|Accept All|Reject All|\/src\/acquisition\.ts|googletagmanager|clarity\.ms|bzrcdn\.openai\.com|cdn\.taboola\.com/, path);
    if (!['/unsubscribe/index.html', '/repo-rodeo-bug/index.html'].includes(path)) {
      assert.equal((html.match(/src="\/src\/privacy\.ts"/g) || []).length, 1, path);
    }
  }
});

function visit({ choice = '', blockedStorage = false, blockedCookies = false, cookies = '' } = {}) {
  const initial = new Map([
    ['mainbrella-cookie-consent', choice], ['mainbrella-acquisition', '{}'],
    ['mainbrella:acquisition-pending', '{}'], ['mainbrella:acquisition-account', 'account'],
    ['mainbrella-confirmed-checkouts', '[]'], ['mainbrella-machine-days:account', '{}'],
    ['mainbrella-prepaid-topup:account', 'pending payment'], ['mainbrella-build-drafts:account', 'draft'],
  ]);
  const values = [new Map(initial), new Map(initial)];
  const writes: string[] = [];
  const storage = (items: Map<string, string>) => ({
    get length() { if (blockedStorage) throw new Error('Storage blocked'); return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => items.delete(key),
  });
  runInNewContext(cleanup, {
    window: { localStorage: storage(values[0]), sessionStorage: storage(values[1]),
      location: { hostname: 'www.mainbrella.com', pathname: '/docs/containers/' } },
    document: {
      get cookie() { if (blockedCookies) throw new Error('Cookies blocked'); return cookies; },
      set cookie(value: string) { writes.push(value); },
    },
  });
  return { values, writes };
}

for (const choice of ['', 'accepted', 'rejected']) {
  test(`legacy ${choice || 'unset'} preference is removed while payment and draft state are preserved`, () => {
    const f = visit({ choice });
    for (const values of f.values) {
      assert.deepEqual([...values], [
        ['mainbrella-prepaid-topup:account', 'pending payment'], ['mainbrella-build-drafts:account', 'draft'],
      ]);
    }
    assert.deepEqual(f.writes, []);
  });
}

test('known first-party tracking cookies are expired at host, parent domain and current paths without touching essential cookies', () => {
  const f = visit({ cookies: '_ga=old; _ga_TEST=old; _gid=old; _gcl_au=old; _clck=old; _clsk=old; mainbrella_session=auth; __cf_bm=security; __stripe_mid=fraud' });
  assert.deepEqual([...new Set(f.writes.map(value => value.split('=')[0]))], ['_ga', '_ga_TEST', '_gid', '_gcl_au', '_clck', '_clsk']);
  assert.ok(f.writes.every(value => value.includes('Max-Age=0')));
  assert.ok(f.writes.includes('_clck=; Max-Age=0; Path=/'));
  assert.ok(f.writes.includes('_clck=; Max-Age=0; Path=/docs/containers/; Domain=.mainbrella.com'));
});

test('blocked storage and cookies cannot interrupt the page or sign-in', () => {
  assert.doesNotThrow(() => visit({ blockedStorage: true, blockedCookies: true }));
  const f = visit({ blockedStorage: true, cookies: '_clck=old' });
  assert.ok(f.writes.length > 0, 'cookie cleanup still runs when storage is blocked');
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
  const stripePureUrl = pathToFileURL(require.resolve('@stripe/stripe-js/pure')).href;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@stripe/stripe-js/pure') {
        return { url: stripePureUrl, shortCircuit: true };
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
    billingAddressContainer: { replaceChildren() {} } as unknown as HTMLElement,
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
