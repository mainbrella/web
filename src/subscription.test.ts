import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { PrepaidBalance, User } from './types.ts';

const mocks = globalThis as typeof globalThis & { billingTestSession: () => Promise<{ user: User } | null>; billingTracking: string[] };
registerHooks({ resolve(specifier, context, next) {
  const modules: Record<string, string> = {
    './auth.ts': "export const API_ORIGIN='https://api.test'; export const createAuthClient=()=>({readSession:()=>globalThis.billingTestSession()});",
    './acquisition-analytics.ts': "export const trackFunnel=()=>{}; export const trackConfirmedPayment=id=>globalThis.billingTracking.push(id);",
  };
  if (modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  return next(specifier, context);
} });
let sequence = 0;
class Element {
  [key: string]: any;
  constructor(public id: string) {}
  value = ''; checked = false; hidden = false; disabled = false; dataset: Record<string, string> = {}; textContent = '';
  listeners = new Map<string, (event: any) => unknown>();
  addEventListener(type: string, handler: (event: any) => unknown) { this.listeners.set(type, handler); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.({}); }
  async submit() { await this.listeners.get('submit')?.({ preventDefault() {} }); }
  input() { this.listeners.get('input')?.({}); }
  focus() {}
}
const wallet = (extra: Partial<PrepaidBalance> = {}): PrepaidBalance => ({
  balanceCents: 1234, availableBalanceCents: 1000, reservedBalanceCents: 234, currency: 'usd',
  spendLimitCents: 500, monthlyUsageCents: 120, productionHourlyCents: 12, fundedRuntimeMs: 300_000_000,
  minimumProductionRuntimeMs: 86_400_000,
  autoRecharge: { enabled: false, amountCents: 2000, monthlyLimitCents: 10000, spentCents: 0, status: 'disabled' }, ...extra,
});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t: TestContext, extra: Record<string, any> = {}) {
  const nodes = new Map<string, Element>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id)!; };
  const calls: { path: string; body: any; credentials: RequestCredentials | undefined }[] = [];
  const redirects: string[] = [];
  const events = new Map<string, (event: any) => any>();
  const storage = extra.storage || new Map<string, string>();
  let balance: any = extra.balance || wallet();
  let fail: string | null = null;
  let mutationGate: Promise<void> | null = null;
  let readGate: Promise<void> | null = extra.readGate || null;
  let failRead = extra.failRead || false;
  let checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test';
  const replace = (key: string, value: any) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  node('topup-amount').value = '20.00';
  replace('document', { getElementById: node, querySelectorAll: () => [] });
  replace('location', { search: extra.search || '', href: `https://mainbrella.com/pricing/${extra.search || ''}`, assign: (url: string) => redirects.push(url) });
  replace('history', { replaceState() {} });
  replace('window', {
    localStorage: { getItem: () => extra.consent || 'accepted' },
    sessionStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    addEventListener: (type: string, handler: (event: any) => any) => events.set(type, handler),
    dispatchEvent: (event: Event) => events.get(event.type)?.(event),
  });
  mocks.billingTestSession = async () => { if (extra.authGate) await extra.authGate; return extra.signedOut ? null : { user: { id: 'owner', email: 'owner@example.com' } }; };
  mocks.billingTracking = [];
  replace('fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body as string) : null;
    calls.push({ path, body, credentials: options.credentials });
    if (path === '/billing/config') return Response.json({ configured: extra.configured ?? true, minTopupCents: 500, maxTopupCents: 100000 });
    if (path === '/billing/balance') {
      if (readGate) await readGate;
      return failRead ? Response.json({ error: 'billing_unavailable' }, { status: 503 }) : Response.json({ balance });
    }
    if (mutationGate) await mutationGate;
    if (fail) return Response.json({ error: fail }, { status: fail === 'unauthorized' ? 401 : 409 });
    if (path === '/billing/topups') return Response.json({ sessionId: 'cs_test', url: checkoutUrl });
    if (path === '/billing/topups/complete') {
      if (extra.completionError) return Response.json({ error: extra.completionError }, { status: 409 });
      balance = wallet({ balanceCents: 3234, availableBalanceCents: 3000 });
      return Response.json({ balance });
    }
    if (path === '/billing/settings') {
      balance = { ...balance, ...body, ...(body.autoRecharge ? { autoRecharge: { ...balance.autoRecharge, ...body.autoRecharge } } : {}) };
      return Response.json({ balance });
    }
    return Response.json({ error: 'unexpected_route' }, { status: 404 });
  });
  await import(`./subscription.ts?test=${++sequence}`);
  await tick();
  return { node, calls, redirects, storage, events, setFail(value: string | null) { fail = value; },
    setGate(value: Promise<void> | null) { mutationGate = value; }, setReadGate(value: Promise<void> | null) { readGate = value; },
    setReadFailure(value: boolean) { failRead = value; }, setCheckoutUrl(value: string) { checkoutUrl = value; },
    changeAccount(value: User | null) { events.get('auth-change')?.({ detail: { user: value } }); },
  };
}

test('prepaid page shows balance, reserved funds and usage without opening a payment on load', async t => {
  const f = await fixture(t);
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.node('billing-available').textContent, '$10.00');
  assert.equal(f.node('billing-reserved').textContent, '$2.34');
  assert.equal(f.node('billing-usage').textContent, '$1.20');
  assert.equal(f.node('topup-submit').disabled, false);
  assert.equal(f.calls.some(call => call.body !== null), false);
  assert.equal(f.calls.find(call => call.path === '/billing/balance')?.credentials, 'include');
});

test('signed-out and rejected-cookie visitors cannot add balance or fetch an account wallet', async t => {
  const f = await fixture(t, { signedOut: true, consent: 'rejected' });
  assert.equal(f.node('prepaid-billing').hidden, true);
  assert.equal(f.node('billing-login').hidden, false);
  assert.equal(f.calls.some(call => call.path === '/billing/balance'), false);
  await f.node('topup-form').submit();
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
});

test('top-up validates its minimum and decimal precision before checkout', async t => {
  const f = await fixture(t);
  for (const value of ['4.99', '20.001', '1000.01']) {
    f.node('topup-amount').value = value;
    await f.node('topup-form').submit();
  }
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
  assert.match(f.node('topup-status').textContent, /two decimal places/);
});

test('a lost checkout response retries the same saved request and never invents balance', async t => {
  const f = await fixture(t);
  f.setFail('billing_unavailable');
  await f.node('topup-form').submit();
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  const initial = f.calls.find(call => call.path === '/billing/topups')!.body;
  assert.match(initial.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(initial.amountCents, 2000);
  assert.match(f.node('topup-status').textContent, /same payment/);
  f.setFail(null);
  await f.node('topup-form').submit();
  assert.deepEqual(f.calls.filter(call => call.path === '/billing/topups').map(call => call.body), [initial, initial]);
  assert.deepEqual(f.redirects, ['https://checkout.stripe.com/c/pay/cs_test']);
  assert.equal(f.node('billing-balance').textContent, '$12.34');
});

test('an uncertain top-up survives page reload and cannot silently change amount', async t => {
  const saved = { requestId: 'a4b63055-32c7-4256-a671-a11211884d18', amountCents: 5000 };
  const storage = new Map([['mainbrella-prepaid-topup:owner', JSON.stringify(saved)]]);
  const f = await fixture(t, { storage });
  assert.equal(f.node('topup-amount').value, '50.00');
  f.node('topup-amount').value = '20.00';
  await f.node('topup-form').submit();
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
  assert.match(f.node('topup-status').textContent, /already in progress/);
  await f.node('topup-form').submit();
  assert.deepEqual(f.calls.find(call => call.path === '/billing/topups')!.body, saved);
});

test('duplicate submit is blocked while checkout is being created', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const first = f.node('topup-form').submit();
  await tick();
  await f.node('topup-form').submit();
  assert.equal(f.calls.filter(call => call.path === '/billing/topups').length, 1);
  assert.equal(f.node('usage-save').disabled, true);
  release(); await first;
});

test('checkout navigation requires Stripe HTTPS and rejects lookalike hosts', async t => {
  const f = await fixture(t);
  for (const url of ['https://checkout.stripe.com.evil.test/pay', 'http://checkout.stripe.com/pay', 'https://user@checkout.stripe.com/pay']) {
    f.setCheckoutUrl(url);
    await f.node('topup-form').submit();
  }
  assert.deepEqual(f.redirects, []);
  assert.equal(f.node('topup-submit').disabled, false);
});

test('return confirms server-paid funds without starting a new checkout', async t => {
  const f = await fixture(t, { search: '?topup_session=cs_paid' });
  assert.equal(f.node('billing-balance').textContent, '$32.34');
  assert.match(f.node('billing-status').textContent, /Payment confirmed/);
  assert.deepEqual(f.calls.find(call => call.path === '/billing/topups/complete')!.body, { sessionId: 'cs_paid' });
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
  assert.deepEqual(mocks.billingTracking, ['cs_paid']);
});

test('a pending payment never adds available funds or emits a confirmed payment', async t => {
  const f = await fixture(t, { search: '?topup_session=cs_pending', completionError: 'payment_pending' });
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.node('billing-available').textContent, '$10.00');
  assert.match(f.node('billing-status').textContent, /No funds have been added/);
  assert.deepEqual(mocks.billingTracking, []);
});

test('a billing read failure shows unavailable balance and refresh can recover it', async t => {
  const f = await fixture(t, { failRead: true });
  assert.equal(f.node('billing-balance').textContent, '—');
  assert.equal(f.node('topup-submit').disabled, true);
  assert.match(f.node('billing-status').textContent, /Could not load your balance/);
  f.setReadFailure(false);
  await f.node('billing-refresh').click();
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.node('topup-submit').disabled, false);
});

test('unconfigured billing explicitly blocks payments', async t => {
  const f = await fixture(t, { configured: false });
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.match(f.node('billing-status').textContent, /Payments are unavailable/);
  assert.equal(f.node('topup-submit').disabled, true);
  await f.node('topup-form').submit();
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
});

test('monthly cap saves without authorization to charge and preserves inputs on failure', async t => {
  const f = await fixture(t);
  f.node('usage-spend-limit').value = '180.00';
  f.node('usage-spend-limit').input();
  f.setFail('spend_limit_below_usage');
  await f.node('usage-limit-form').submit();
  assert.equal(f.node('usage-spend-limit').value, '180.00');
  assert.match(f.node('usage-status').textContent, /already used or reserved/);
  f.setFail(null);
  await f.node('usage-limit-form').submit();
  assert.deepEqual(f.calls.filter(call => call.path === '/billing/settings').at(-1)?.body, { spendLimitCents: 18000 });
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
});

test('automatic recharge needs explicit enablement, amount and a sufficient monthly maximum', async t => {
  const f = await fixture(t);
  assert.equal(f.node('recharge-enabled').checked, false);
  assert.equal(f.node('recharge-options').hidden, true);
  f.node('recharge-enabled').checked = true; f.node('recharge-enabled').input();
  f.node('recharge-amount').value = '50.00'; f.node('recharge-amount').input();
  f.node('recharge-maximum').value = '20.00'; f.node('recharge-maximum').input();
  await f.node('recharge-form').submit();
  assert.equal(f.calls.some(call => call.path === '/billing/settings'), false);
  f.node('recharge-maximum').value = '100.00'; f.node('recharge-maximum').input();
  await f.node('recharge-form').submit();
  assert.deepEqual(f.calls.find(call => call.path === '/billing/settings')!.body, { autoRecharge: { enabled: true, amountCents: 5000, monthlyLimitCents: 10000 } });
});

test('recharge requiring authentication directs customers to manual payment without crediting pending funds', async t => {
  const f = await fixture(t, { balance: wallet({ autoRecharge: { enabled: true, amountCents: 2000, monthlyLimitCents: 10000, spentCents: 0, status: 'requires_action' } }) });
  assert.match(f.node('recharge-payment-status').textContent, /Add balance manually/);
  assert.equal(f.node('billing-balance').textContent, '$12.34');
});

test('signing out while wallet loads cannot restore account data', async t => {
  let release!: () => void;
  const f = await fixture(t, { readGate: new Promise<void>(resolve => { release = resolve; }) });
  f.changeAccount(null);
  release(); await tick();
  assert.equal(f.node('prepaid-billing').hidden, true);
  assert.equal(f.node('billing-balance').textContent, '—');
  assert.equal(f.node('billing-login').hidden, false);
});

test('switching accounts during top-up creation prevents stale checkout navigation', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const payment = f.node('topup-form').submit();
  await tick();
  f.changeAccount({ id: 'next-owner' });
  release(); await payment; await tick();
  assert.deepEqual(f.redirects, []);
  assert.equal(f.node('topup-amount').value, '20.00');
});

test('a late shared balance event from another account is ignored', async t => {
  const f = await fixture(t);
  f.events.get('billing-balance-change')?.({ detail: { userId: 'other', balance: wallet({ balanceCents: 99000 }) } });
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  f.events.get('billing-balance-change')?.({ detail: { userId: 'owner', balance: wallet({ balanceCents: 3456 }) } });
  assert.equal(f.node('billing-balance').textContent, '$34.56');
});

test('the hosted Stripe return URL verifies its session ID', async t => {
  const f = await fixture(t, { search: '?topup_return=1&session_id=cs_hosted' });
  assert.equal(f.node('billing-balance').textContent, '$32.34');
  assert.deepEqual(f.calls.find(call => call.path === '/billing/topups/complete')!.body, { sessionId: 'cs_hosted' });
});

test('disabling recharge uses saved valid amounts even after an invalid edit', async t => {
  const f = await fixture(t);
  f.node('recharge-enabled').checked = true; f.node('recharge-enabled').input();
  f.node('recharge-amount').value = '1.00'; f.node('recharge-amount').input();
  f.node('recharge-enabled').checked = false; f.node('recharge-enabled').input();
  await f.node('recharge-form').submit();
  assert.deepEqual(f.calls.find(call => call.path === '/billing/settings')!.body,
    { autoRecharge: { enabled: false, amountCents: 2000, monthlyLimitCents: 10000 } });
});

test('a malformed wallet never displays a false zero or enables compute payments', async t => {
  const f = await fixture(t, { balance: { balanceCents: '0' } });
  assert.equal(f.node('billing-balance').textContent, '—');
  assert.equal(f.node('topup-submit').disabled, true);
  assert.match(f.node('billing-status').textContent, /Could not load your balance/);
});

test('negative balance after a refund remains visible with zero spendable funds', async t => {
  const f = await fixture(t, { balance: wallet({ balanceCents: -123, availableBalanceCents: 0, reservedBalanceCents: 0 }) });
  assert.equal(f.node('billing-balance').textContent, '-$1.23');
  assert.equal(f.node('billing-available').textContent, '$0.00');
  assert.equal(f.node('topup-submit').disabled, false);
});

test('an expired session clears cached balance after a billing mutation', async t => {
  const f = await fixture(t);
  f.setFail('unauthorized');
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.node('prepaid-billing').hidden, true);
  assert.equal(f.node('billing-balance').textContent, '—');
  assert.equal(f.node('billing-login').hidden, false);
});

for (const [status, message] of [['monthly_limit_reached', /monthly maximum/], ['reconciliation_required', /Pending funds are unavailable/]] as const) {
  test(`automatic recharge ${status} is shown as blocked, with a recovery action`, async t => {
    const f = await fixture(t, { balance: wallet({ autoRecharge: { enabled: true, amountCents: 2000, monthlyLimitCents: 10000, spentCents: 0, status } }) });
    assert.match(f.node('recharge-payment-status').textContent, message);
    assert.equal(f.node('recharge-payment-status').dataset.state, 'error');
  });
}
