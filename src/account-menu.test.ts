import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { User, PrepaidBalance } from './types.ts';

const mocks = globalThis as typeof globalThis & { accountTestSession: () => Promise<{ user: User } | null>; accountTestSignOut: () => Promise<void> };
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './auth.ts') return { url: `data:text/javascript,${encodeURIComponent("export const API_ORIGIN='https://api.test';export const createAuthClient=()=>({readSession:()=>globalThis.accountTestSession(),signOut:()=>globalThis.accountTestSignOut()});")}`, shortCircuit: true };
  return next(specifier, context);
} });
let sequence = 0;
class Element {
  [key: string]: any;
  hidden = false; disabled = false; textContent = ''; innerHTML = ''; listeners = new Map();
  attributes = new Map();
  classList = { toggle() {} };
  children = new Map<string, Element>();
  addEventListener(type: string, handler: (event: any) => unknown) { this.listeners.set(type, handler); }
  querySelector(selector: string) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector)!; }
  querySelectorAll() { return []; }
  appendChild(child: Element) { this.appended = child; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.({}); }
  focus() {}
  contains(value: unknown) { return value === this; }
}
const wallet = (cents = 1234): PrepaidBalance => ({ balanceCents: cents, availableBalanceCents: Math.max(cents - 200, 0), reservedBalanceCents: 200,
  currency: 'usd', spendLimitCents: 500, monthlyUsageCents: 50, productionHourlyCents: 0, fundedRuntimeMs: null,
  minimumProductionRuntimeMs: 86_400_000, autoRecharge: { enabled: false, amountCents: 2000, monthlyLimitCents: 10000, spentCents: 0, status: 'disabled' } });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t: TestContext, extra: Record<string, any> = {}) {
  const nav = new Element();
  const documentElement = new Element();
  const events = new Map();
  const calls: string[] = [];
  let fail = false;
  let gate: Promise<void> | null = null;
  let nextBalance = wallet();
  const replace = (key: string, value: any) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  replace('document', { querySelector: () => nav, createElement: () => new Element(), documentElement, addEventListener() {} });
  replace('window', { location: { pathname: '/dashboard/' },
    addEventListener: (type: string, handler: (event: any) => unknown) => events.set(type, handler),
    dispatchEvent: (event: Event) => events.get(event.type)?.(event),
  });
  mocks.accountTestSession = async () => extra.signedOut ? null : { user: { id: 'owner', email: 'owner@example.com' } };
  mocks.accountTestSignOut = async () => { events.get('auth-change')?.({ detail: { user: null } }); };
  replace('fetch', async (url: string, options: RequestInit) => {
    assert.equal(options.credentials, 'include'); calls.push(url);
    const readBalance = nextBalance;
    if (gate) await gate;
    return fail ? Response.json({ error: 'billing_unavailable' }, { status: 503 }) : Response.json({ balance: readBalance });
  });
  await import(`./account-menu.ts?test=${++sequence}`);
  await tick();
  const account = nav.appended as Element;
  const node = (selector: string) => account.querySelector(selector);
  // The test double does not parse innerHTML, so honor the panel's initial hidden attribute.
  node('.account-panel').hidden = true;
  return { account, node, calls, events, setFailure(value: boolean) { fail = value; },
    setGate(value: Promise<void> | null) { gate = value; }, setBalance(value: PrepaidBalance) { nextBalance = value; },
    changeAccount(user: User | null) { events.get('auth-change')?.({ detail: { user } }); },
    publish(userId: string, balance?: PrepaidBalance) { events.get('billing-balance-change')?.({ detail: { userId, balance } }); },
  };
}

test('account menu reads and shows linked current balance only after it opens', async t => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 0);
  assert.match(f.account.innerHTML, /class="account-balance" href="\/balance\/"/);
  await f.node('.account-toggle').click(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.node('.account-balance-value').textContent, '$12.34');
});

test('failed balance loads show unavailable rather than zero and recover on next open', async t => {
  const f = await fixture(t); f.setFailure(true);
  await f.node('.account-toggle').click(); await tick();
  assert.equal(f.node('.account-balance-value').textContent, 'Unavailable');
  await f.node('.account-toggle').click();
  f.setFailure(false);
  await f.node('.account-toggle').click(); await tick();
  assert.equal(f.node('.account-balance-value').textContent, '$12.34');
});

test('a shared payment update refreshes a matching balance without a hidden-menu request', async t => {
  const f = await fixture(t);
  f.publish('owner', wallet(5678));
  assert.equal(f.node('.account-balance-value').textContent, '$56.78');
  assert.equal(f.calls.length, 0);
  f.publish('other', wallet(99999));
  assert.equal(f.node('.account-balance-value').textContent, '$56.78');
});

test('a balance-change notification refreshes an open account menu', async t => {
  const f = await fixture(t);
  await f.node('.account-toggle').click(); await tick();
  f.setBalance(wallet(9876)); f.publish('owner'); await tick();
  assert.equal(f.node('.account-balance-value').textContent, '$98.76');
  assert.equal(f.calls.length, 2);
});

test('signing out ignores late account balance reads and hides the menu', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  await f.node('.account-toggle').click();
  f.changeAccount(null); release(); await tick();
  assert.equal(f.account.hidden, true);
  assert.equal(f.node('.account-balance-value').textContent, 'Loading…');
});

test('switching accounts invalidates previous balance reads', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  await f.node('.account-toggle').click();
  f.changeAccount({ id: 'next-owner', email: 'next@example.com' });
  release(); await tick();
  assert.equal(f.node('.account-balance-value').textContent, 'Loading…');
  f.publish('next-owner', wallet(3500));
  f.publish('owner', wallet(99999));
  assert.equal(f.node('.account-balance-value').textContent, '$35.00');
});

test('a verified shared update supersedes an earlier balance read', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  await f.node('.account-toggle').click();
  f.publish('owner', wallet(5000)); release(); await tick();
  assert.equal(f.node('.account-balance-value').textContent, '$50.00');
});

test('signed-out account menus never request a billing balance', async t => {
  const f = await fixture(t, { signedOut: true });
  await f.node('.account-toggle').click(); await tick();
  assert.equal(f.account.hidden, true);
  assert.equal(f.calls.length, 0);
});
