import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { PrepaidBalance, User } from './types.ts';

const mocks = globalThis as typeof globalThis & {
  billingTestSession: () => Promise<{ user: User } | null>; billingTracking: string[];
  billingLoadStripe: () => Promise<any>;
};
registerHooks({ resolve(specifier, context, next) {
  const modules: Record<string, string> = {
    './auth.ts': "export const API_ORIGIN='https://api.test'; export const createAuthClient=()=>({readSession:()=>globalThis.billingTestSession()});",
    './acquisition-analytics.ts': "export const trackFunnel=()=>{}; export const trackConfirmedPayment=id=>globalThis.billingTracking.push(id);",
    '@stripe/stripe-js/pure': "export const loadStripe=()=>globalThis.billingLoadStripe();",
  };
  if (modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  return next(specifier, context);
} });
let sequence = 0;
class Element {
  [key: string]: any;
  constructor(public id: string) {}
  value = ''; checked = false; hidden = false; disabled = false; dataset: Record<string, string> = {}; textContent = '';
  prevented = false;
  listeners = new Map<string, (event: any) => unknown>();
  addEventListener(type: string, handler: (event: any) => unknown) { this.listeners.set(type, handler); }
  removeEventListener(type: string) { this.listeners.delete(type); }
  replaceChildren() {}
  setAttribute() {}
  reportValidity() { return true; }
  validity = { valid: true };
  async click() { if (!this.disabled) await this.listeners.get('click')?.({}); }
  async submit() { await this.listeners.get('submit')?.({ preventDefault() {} }); }
  input() { this.listeners.get('input')?.({}); }
  async key(key: string) {
    const event = { key, prevented: false, preventDefault() { this.prevented = true; } };
    await this.listeners.get('keydown')?.(event);
    this.prevented = event.prevented;
  }
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
  const tryFlow = new URLSearchParams(extra.search || '').get('flow') === 'try';
  const creditCents = tryFlow ? 500 : 2000;
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
  let checkoutData: any = { sessionId: 'cs_test', client_secret: 'cs_test_secret_inline', publishable_key: `pk_test_fixture_${sequence + 1}` };
  let completionError: string | null = extra.completionError || null;
  const topupErrors: string[] = [...(extra.topupErrors || [])];
  const stripeSession = { id: 'cs_test', email: 'owner@example.com', canConfirm: Boolean(extra.zeroTotal),
    total: { total: { amount: extra.zeroTotal ? '$0.00' : `$${(creditCents / 100).toFixed(2)}`, minorUnitsAmount: extra.zeroTotal ? 0 : creditCents },
      discount: { amount: '$0.00', minorUnitsAmount: 0 } }, discountAmounts: [] as any[] };
  const promotionCalls: string[] = [];
  const confirmations: any[] = [];
  let sessionChanged: (session: any) => void = () => {};
  const paymentEvents = new Map<string, (event?: any) => void>();
  const addressEvents = new Map<string, (event?: any) => void>();
  let billingAddressComplete = extra.billingAddressComplete !== false;
  let cardComplete = false;
  let addressCreations = 0;
  let addressDestructions = 0;
  let mounted = false;
  let destroyed = false;
  let paymentMounted = false;
  let paymentCreations = 0;
  let paymentDestructions = 0;
  let confirmGate: Promise<void> | null = null;
  let confirmationError: string | null = null;
  function updateCanConfirm() {
    stripeSession.canConfirm = billingAddressComplete && (stripeSession.total.total.minorUnitsAmount === 0
      ? !paymentMounted && extra.noCostCanConfirm !== false : cardComplete);
  }
  const actions = {
    getSession: () => stripeSession,
    updateEmail: async () => ({ type: 'success' }),
    applyPromotionCode: async (code: string) => {
      promotionCalls.push(code);
      if (extra.promotionGate) await extra.promotionGate;
      if (extra.promotionError || !['SAVE5', 'FREE', 'BRELLA-GIT-TRY5'].includes(code)) return { type: 'error', error: { message: extra.promotionError || 'That promotion code is invalid.' } };
      const discountCents = code === 'FREE' ? creditCents : 500;
      stripeSession.total.discount = { amount: `$${(discountCents / 100).toFixed(2)}`, minorUnitsAmount: discountCents };
      stripeSession.total.total.amount = `$${((creditCents - discountCents) / 100).toFixed(2)}`;
      stripeSession.total.total.minorUnitsAmount = creditCents - discountCents;
      stripeSession.discountAmounts = [{ promotionCode: code }];
      // Mounted, incomplete card fields prevent confirmation until removed.
      if (creditCents === discountCents) updateCanConfirm();
      sessionChanged(stripeSession);
      return { type: 'success' };
    },
    removePromotionCode: async () => {
      stripeSession.total.total.amount = '$20.00';
      stripeSession.total.total.minorUnitsAmount = 2000;
      stripeSession.total.discount = { amount: '$0.00', minorUnitsAmount: 0 };
      stripeSession.discountAmounts = [];
      stripeSession.canConfirm = false;
      sessionChanged(stripeSession);
      return { type: 'success' };
    },
    confirm: async (options: any) => {
      confirmations.push(options);
      if (confirmGate) await confirmGate;
      if (confirmationError) return { type: 'error', error: { message: confirmationError } };
      stripeSession.canConfirm = false;
      sessionChanged(stripeSession);
      return { type: 'success', session: stripeSession };
    },
  };
  mocks.billingLoadStripe = async () => {
    if (extra.stripeGate) await extra.stripeGate;
    return { initCheckoutElementsSdk: () => ({
      loadActions: async () => ({ type: 'success', actions }),
      on: (_type: string, handler: (session: any) => void) => { sessionChanged = handler; },
      createBillingAddressElement: () => { addressCreations++; return {
        on: (type: string, handler: (event?: any) => void) => addressEvents.set(type, handler),
        mount: (container: Element) => {
          container.textContent = 'Billing address';
          updateCanConfirm();
          addressEvents.get('change')?.({ complete: billingAddressComplete });
        },
        destroy: () => { addressDestructions++; },
      }; },
      createPaymentElement: () => { paymentCreations++; return {
        on: (type: string, handler: (event?: any) => void) => paymentEvents.set(type, handler),
        mount: () => { mounted = true; paymentMounted = true; paymentEvents.get('ready')?.(); },
        destroy: () => {
          destroyed = true; paymentMounted = false; paymentDestructions++;
          updateCanConfirm();
        },
      }; },
    }) };
  };
  const replace = (key: string, value: any) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  node('topup-amount').value = '20.00';
  node('inline-checkout').hidden = true;
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
    if (path === '/billing/topups') {
      const error = topupErrors.shift();
      return error ? Response.json({ error }, { status: 409 }) : Response.json(checkoutData);
    }
    if (path === '/billing/topups/complete') {
      if (completionError) return Response.json({ error: completionError }, { status: 409 });
      balance = tryFlow ? wallet({ balanceCents: 500, availableBalanceCents: 500 }) : wallet({ balanceCents: 3234, availableBalanceCents: 3000 });
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
    setReadFailure(value: boolean) { failRead = value; }, setCheckoutData(value: any) { checkoutData = value; },
    setCompletionError(value: string | null) { completionError = value; },
    setConfirmationError(value: string | null) { confirmationError = value; },
    setConfirmGate(value: Promise<void> | null) { confirmGate = value; },
    paymentReady(complete = true) { cardComplete = complete; updateCanConfirm(); sessionChanged(stripeSession); },
    completeBillingAddress(complete = true) {
      billingAddressComplete = complete; updateCanConfirm();
      addressEvents.get('change')?.({ complete }); sessionChanged(stripeSession);
    },
    billingAddressLoadError() { addressEvents.get('loaderror')?.({ error: { message: 'Unable to load billing address.' } }); },
    setPromotionGate(value: Promise<void> | null) { extra.promotionGate = value; },
    paymentLoadError() { paymentEvents.get('loaderror')?.({ error: { message: 'Unable to load card details.' } }); },
    confirmations, promotionCalls, isMounted: () => mounted, isDestroyed: () => destroyed,
    paymentCreations: () => paymentCreations, paymentDestructions: () => paymentDestructions,
    addressCreations: () => addressCreations, addressDestructions: () => addressDestructions,
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
  assert.equal(f.isMounted(), false);
  assert.equal(f.calls.find(call => call.path === '/billing/balance')?.credentials, 'include');
});

const repoFunding = { repo: 'owner/repo', returnTo: '/run/?flow=try&private=1#config=9c854f89-5f3e-467c-b5f2-0bc6685ef75c' };
const trySearch = `?${new URLSearchParams({ flow: 'try', ...repoFunding })}`;
const emptyWallet = () => wallet({ balanceCents: 0, availableBalanceCents: 0, reservedBalanceCents: 0 });

test('try checkout automatically applies the $5 offer without card fields or unverified credit', async t => {
  const f = await fixture(t, { search: trySearch, balance: emptyWallet() });
  await tick();
  assert.equal(f.calls.find(call => call.path === '/billing/topups')?.body.amountCents, 500);
  assert.deepEqual(f.promotionCalls, ['BRELLA-GIT-TRY5']);
  assert.equal(f.node('checkout-promotion-code').value, 'BRELLA-GIT-TRY5');
  assert.equal(f.node('try-credit-value').textContent, '$5.00');
  assert.equal(f.node('try-credit-discount').textContent, '−$5.00');
  assert.equal(f.node('try-credit-due').textContent, '$0.00');
  assert.equal(f.node('checkout-submit').textContent, 'Confirm $5 credit and continue');
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.equal(f.paymentCreations(), 0);
  assert.equal(f.node('billing-balance').textContent, '$0.00');
  assert.equal(f.calls.some(call => call.path === '/billing/topups/complete'), false);
  assert.equal(f.node('checkout-promotion').open, true);
  const back = new URL(f.node('try-checkout-back').href, 'https://mainbrella.com');
  assert.equal(back.searchParams.get('prepare'), '1');
  assert.equal(back.hash, new URL(repoFunding.returnTo, back.origin).hash);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.node('billing-balance').textContent, '$5.00');
  assert.deepEqual(f.redirects, [repoFunding.returnTo]);
});

test('try checkout waits for promo validation and preserves credit confirmation for pending results', async t => {
  let release!: () => void;
  const f = await fixture(t, { search: trySearch, balance: emptyWallet(), promotionGate: new Promise<void>(resolve => { release = resolve; }), completionError: 'payment_pending' });
  await tick();
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.paymentCreations(), 0);
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  release(); await tick();
  await f.node('checkout-form').submit(); await tick();
  assert.deepEqual(f.redirects, []);
  assert.equal(f.node('billing-balance').textContent, '$0.00');
  f.setCompletionError(null);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.deepEqual(f.redirects, [repoFunding.returnTo]);
});

test('free try credit collects the required billing address before enabling confirmation', async t => {
  const f = await fixture(t, { search: trySearch, balance: emptyWallet(), billingAddressComplete: false });
  await tick();
  assert.equal(f.node('try-credit-due').textContent, '$0.00');
  assert.equal(f.addressCreations(), 1);
  assert.equal(f.node('checkout-billing-address').textContent, 'Billing address');
  assert.equal(f.paymentCreations(), 0);
  assert.equal(f.node('checkout-payment-slot').hidden, true);
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.node('checkout-status').textContent, 'Complete your billing address to continue.');
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  f.completeBillingAddress();
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.match(f.node('checkout-status').textContent, /No payment is due/);
  f.completeBillingAddress(false);
  assert.equal(f.node('checkout-submit').disabled, true);
  f.completeBillingAddress();
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.addressDestructions(), 1);
  assert.equal(f.node('billing-balance').textContent, '$5.00');
  assert.deepEqual(f.redirects, [repoFunding.returnTo]);
});

test('paid checkout requires both the billing address and valid card details', async t => {
  const f = await fixture(t, { billingAddressComplete: false });
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.addressCreations(), 1);
  f.paymentReady();
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.match(f.node('checkout-status').textContent, /billing address/);
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  f.completeBillingAddress();
  assert.equal(f.node('checkout-submit').disabled, false);
  f.paymentReady(false);
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.match(f.node('checkout-status').textContent, /card details/);
  f.paymentReady();
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.addressDestructions(), 1);
});

test('a billing address load failure blocks confirmation and closing ignores late events', async t => {
  const f = await fixture(t, { zeroTotal: true });
  await f.node('topup-form').submit(); await tick();
  f.billingAddressLoadError();
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.node('checkout-status').textContent, 'Unable to load billing address.');
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  await f.node('checkout-back').click();
  assert.equal(f.addressDestructions(), 1);
  f.completeBillingAddress();
  assert.equal(f.node('checkout-status').textContent, 'Unable to load billing address.');
  assert.equal(f.node('checkout-submit').disabled, true);
});

test('a rejected try promo displays the real price and requires card confirmation', async t => {
  const f = await fixture(t, { search: trySearch, balance: emptyWallet(), promotionError: 'This code has expired.' });
  await tick();
  assert.equal(f.node('try-credit-discount').textContent, '$0.00');
  assert.equal(f.node('try-credit-due').textContent, '$5.00');
  assert.equal(f.node('checkout-submit').textContent, 'Pay $5.00');
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.paymentCreations(), 1);
  assert.match(f.node('checkout-promotion-status').textContent, /expired/);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.node('billing-balance').textContent, '$0.00');
});

test('a Stripe return restores the account-owned repository destination and verifies before returning', async t => {
  const saved = { requestId: 'a4b63055-32c7-4256-a671-a11211884d18', amountCents: 500, sessionId: 'cs_test', repoFunding };
  const storage = new Map([['mainbrella-prepaid-topup:owner', JSON.stringify(saved)]]);
  const f = await fixture(t, { storage, search: '?topup_return=1&session_id=cs_test' });
  assert.deepEqual(f.redirects, [repoFunding.returnTo]);
  assert.equal(f.calls.filter(call => call.path === '/billing/topups/complete').length, 1);
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
});

test('try checkout preserves sign-in context and rejects foreign destinations', async t => {
  const f = await fixture(t, { search: trySearch, signedOut: true });
  const login = new URL(f.node('billing-login').href, 'https://mainbrella.com');
  assert.equal(login.searchParams.get('returnTo'), `/pricing/${trySearch}`);
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
});

test('an invalid try return does not start checkout or prefill a promotion', async t => {
  const f = await fixture(t, { search: `?${new URLSearchParams({ flow: 'try', repo: 'owner/repo', returnTo: '//evil.test/run/' })}` });
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
  assert.equal(f.node('topup-amount').value, '20.00');
});

test('try checkout does not replace another pending purchase', async t => {
  const saved = { requestId: 'a4b63055-32c7-4256-a671-a11211884d18', amountCents: 5000, sessionId: 'cs_other' };
  const storage = new Map([['mainbrella-prepaid-topup:owner', JSON.stringify(saved)]]);
  const f = await fixture(t, { storage, search: trySearch });
  assert.equal(f.calls.some(call => call.path === '/billing/topups'), false);
  assert.equal(f.storage.get('mainbrella-prepaid-topup:owner'), JSON.stringify(saved));
  assert.match(f.node('topup-status').textContent, /Another top-up/);
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
  await tick();
  assert.deepEqual(f.redirects, []);
  assert.equal(f.isMounted(), true);
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

test('checkout requires an embedded session and never falls back to external navigation', async t => {
  const f = await fixture(t);
  for (const data of [
    { sessionId: 'cs_test', url: 'https://checkout.stripe.com/c/pay/cs_test' },
    { sessionId: 'cs_test', client_secret: 'cs_other_secret_inline', publishable_key: 'pk_test_inline' },
    { sessionId: 'cs_test', client_secret: 'cs_test_secret_inline', publishable_key: '' },
  ]) {
    f.setCheckoutData(data);
    await f.node('topup-form').submit();
  }
  assert.deepEqual(f.redirects, []);
  assert.equal(f.isMounted(), false);
  assert.equal(f.node('topup-submit').disabled, false);
});

test('an expired checkout opens a fresh embedded form in the same action', async t => {
  const saved = { requestId: 'a4b63055-32c7-4256-a671-a11211884d18', amountCents: 5000, sessionId: 'cs_old_hosted' };
  const storage = new Map([['mainbrella-prepaid-topup:owner', JSON.stringify(saved)]]);
  const f = await fixture(t, { storage, topupErrors: ['topup_expired'] });
  await f.node('topup-form').submit(); await tick();
  const requests = f.calls.filter(call => call.path === '/billing/topups').map(call => call.body);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, saved.requestId);
  assert.notEqual(requests[1].requestId, saved.requestId);
  assert.deepEqual(requests.map(request => request.amountCents), [5000, 5000]);
  assert.equal(f.isMounted(), true);
  assert.equal(f.node('inline-checkout').hidden, false);
  assert.equal(f.node('topup-status').textContent, '');
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.calls.some(call => call.path === '/billing/topups/complete'), false);
  assert.deepEqual(f.redirects, []);
});

test('automatic replacement is bounded if the new checkout also expires', async t => {
  const f = await fixture(t, { topupErrors: ['topup_expired', 'topup_expired'] });
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.calls.filter(call => call.path === '/billing/topups').length, 2);
  assert.equal(f.isMounted(), false);
  assert.equal(f.storage.size, 0);
  assert.equal(f.node('topup-submit').disabled, false);
});

test('an uncertain old-session expiry preserves the same purchase for retry', async t => {
  const f = await fixture(t, { topupErrors: ['billing_unavailable'] });
  await f.node('topup-form').submit();
  const first = f.calls.find(call => call.path === '/billing/topups')!.body;
  assert.equal(f.calls.filter(call => call.path === '/billing/topups').length, 1);
  await f.node('topup-form').submit(); await tick();
  assert.deepEqual(f.calls.filter(call => call.path === '/billing/topups').map(call => call.body), [first, first]);
  assert.equal(f.isMounted(), true);
});

test('the inline form credits balance only after server payment verification', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.node('inline-checkout').hidden, false);
  assert.equal(f.node('checkout-payment-slot').dataset.loading, 'false');
  assert.equal(f.node('topup-amount').disabled, true);
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  f.paymentReady();
  await f.node('checkout-form').submit(); await tick();
  assert.deepEqual(f.confirmations, [{ redirect: 'if_required' }]);
  assert.deepEqual(f.calls.find(call => call.path === '/billing/topups/complete')?.body, { sessionId: 'cs_test' });
  assert.equal(f.node('billing-balance').textContent, '$32.34');
  assert.equal(f.node('inline-checkout').hidden, true);
  assert.equal(f.isDestroyed(), true);
  assert.equal(f.storage.size, 0);
  assert.deepEqual(mocks.billingTracking, ['cs_test']);
  assert.equal(f.node('topup-submit').disabled, false);
  assert.deepEqual(f.redirects, []);
});

test('Pay explains incomplete card details and enables as Stripe validates the form', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.node('checkout-status').textContent, 'Complete your card details to enable payment.');
  f.paymentReady();
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.equal(f.node('checkout-status').textContent, '');
  f.paymentReady(false);
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.equal(f.node('checkout-status').textContent, 'Complete your card details to enable payment.');
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
});

test('Stripe promotion codes update the prepaid total and can be removed', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  const code = f.node('checkout-promotion-code');
  code.value = 'SAVE5'; code.input();
  assert.equal(f.node('checkout-promotion-apply').disabled, false);
  await code.key('Enter');
  assert.equal(code.prevented, true);
  assert.equal(f.node('checkout-total').textContent, 'Due today: $15.00');
  assert.equal(f.node('checkout-submit').textContent, 'Pay $15.00');
  assert.equal(f.node('checkout-promotion-remove').hidden, false);
  assert.equal(f.confirmations.length, 0);
  await f.node('checkout-promotion-remove').click();
  assert.equal(f.node('checkout-total').textContent, 'Due today: $20.00');
  assert.equal(f.node('checkout-submit').textContent, 'Pay $20.00');
  assert.equal(f.node('checkout-promotion-remove').hidden, true);
});

test('promotion controls stay disabled while Stripe loads and after a payment load error', async t => {
  let release!: () => void;
  const f = await fixture(t, { stripeGate: new Promise<void>(resolve => { release = resolve; }) });
  await f.node('topup-form').submit();
  assert.equal(f.node('checkout-promotion-code').disabled, true);
  assert.equal(f.node('checkout-promotion-apply').disabled, true);
  release(); await tick();
  assert.equal(f.node('checkout-promotion-code').disabled, false);
  f.paymentLoadError();
  assert.equal(f.node('checkout-promotion-code').disabled, true);
  assert.equal(f.node('checkout-promotion-apply').disabled, true);
});

test('invalid Stripe promotion code stays inline and preserves the entered code', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  const code = f.node('checkout-promotion-code');
  code.value = 'NOPE'; code.input();
  await f.node('checkout-promotion-apply').click();
  assert.equal(code.value, 'NOPE');
  assert.equal(f.node('checkout-promotion-status').textContent, 'That promotion code is invalid.');
  assert.equal(f.node('checkout-promotion-status').dataset.state, 'error');
  assert.equal(f.node('checkout-total').textContent, 'Due today: $20.00');
});

test('promotion update disables payment and duplicate applies until Stripe finishes', async t => {
  let release!: () => void;
  const f = await fixture(t, { promotionGate: new Promise<void>(resolve => { release = resolve; }) });
  await f.node('topup-form').submit(); await tick();
  const code = f.node('checkout-promotion-code');
  code.value = 'SAVE5'; code.input();
  const applying = f.node('checkout-promotion-apply').click(); await tick();
  assert.equal(f.node('checkout-promotion-apply').disabled, true);
  assert.equal(f.node('checkout-submit').disabled, true);
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  release(); await applying;
  assert.equal(f.node('checkout-total').textContent, 'Due today: $15.00');
});

test('a destroyed checkout ignores a late promotion result', async t => {
  let release!: () => void;
  const f = await fixture(t, { promotionGate: new Promise<void>(resolve => { release = resolve; }) });
  await f.node('topup-form').submit(); await tick();
  const code = f.node('checkout-promotion-code');
  code.value = 'SAVE5'; code.input();
  const applying = f.node('checkout-promotion-apply').click(); await tick();
  f.changeAccount({ id: 'next-owner' }); await tick();
  release(); await applying;
  assert.equal(f.node('checkout-total').textContent, 'Due today: $20.00');
  assert.equal(f.node('checkout-promotion-status').textContent, 'Applying code…');
});

test('a full $20 promotion removes incomplete card fields and adds $20 only after confirmation', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  const code = f.node('checkout-promotion-code');
  code.value = 'FREE'; code.input();
  await f.node('checkout-promotion-apply').click();
  assert.equal(f.node('checkout-total').textContent, 'Due today: $0.00');
  assert.equal(f.node('checkout-submit').textContent, 'Confirm');
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.equal(f.node('checkout-payment-slot').hidden, true);
  assert.equal(f.paymentDestructions(), 1);
  assert.match(f.node('checkout-status').textContent, /No payment is due/);
  assert.equal(f.calls.some(call => call.path === '/billing/topups/complete'), false);
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  // A late error from the removed card element must not block free checkout.
  f.paymentLoadError();
  assert.equal(f.node('checkout-submit').disabled, false);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.calls.filter(call => call.path === '/billing/topups/complete').length, 1);
  assert.equal(f.node('billing-balance').textContent, '$32.34');
  assert.equal(f.node('inline-checkout').hidden, true);
  assert.equal(f.storage.size, 0);
});

test('removing a full promotion restores card entry and requires valid payment details', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  f.node('checkout-promotion-code').value = 'FREE';
  f.node('checkout-promotion-code').input();
  await f.node('checkout-promotion-apply').click();
  assert.equal(f.node('checkout-payment-slot').hidden, true);
  await f.node('checkout-promotion-remove').click();
  assert.equal(f.node('checkout-payment-slot').hidden, false);
  assert.equal(f.paymentCreations(), 2);
  assert.equal(f.node('checkout-submit').textContent, 'Pay $20.00');
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.match(f.node('checkout-status').textContent, /Complete your card details/);
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  f.paymentReady();
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.node('billing-balance').textContent, '$32.34');
});

test('reopening a zero-cost checkout never mounts or waits for a card form', async t => {
  const f = await fixture(t, { zeroTotal: true });
  await f.node('topup-form').submit(); await tick();
  assert.equal(f.isMounted(), false);
  assert.equal(f.node('checkout-payment-slot').hidden, true);
  assert.equal(f.node('checkout-payment-slot').dataset.loading, 'false');
  assert.equal(f.node('checkout-submit').disabled, false);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.node('billing-balance').textContent, '$32.34');
});

test('zero-cost checkout still respects Stripe confirmation readiness', async t => {
  const f = await fixture(t, { noCostCanConfirm: false });
  await f.node('topup-form').submit(); await tick();
  f.node('checkout-promotion-code').value = 'FREE';
  f.node('checkout-promotion-code').input();
  await f.node('checkout-promotion-apply').click();
  assert.equal(f.node('checkout-payment-slot').hidden, true);
  assert.equal(f.node('checkout-submit').disabled, true);
  assert.doesNotMatch(f.node('checkout-status').textContent, /card details/);
  await f.node('checkout-form').submit();
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.calls.some(call => call.path === '/billing/topups/complete'), false);
});

test('a pending zero-cost confirmation can retry verification without confirming Stripe twice', async t => {
  const f = await fixture(t, { zeroTotal: true, completionError: 'payment_pending' });
  await f.node('topup-form').submit(); await tick();
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.node('checkout-submit').textContent, 'Retry confirmation');
  assert.equal(f.node('checkout-submit').disabled, false);
  f.setCompletionError(null);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.calls.filter(call => call.path === '/billing/topups/complete').length, 2);
  assert.equal(f.node('billing-balance').textContent, '$32.34');
});

test('retrying a pending inline confirmation verifies again without charging again', async t => {
  const f = await fixture(t, { completionError: 'payment_pending' });
  await f.node('topup-form').submit(); await tick();
  f.paymentReady();
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.match(f.node('checkout-status').textContent, /No funds have been added/);
  assert.equal(f.node('checkout-submit').textContent, 'Retry confirmation');
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.equal(f.node('topup-submit').disabled, true);
  assert.deepEqual(mocks.billingTracking, []);
  f.setCompletionError(null);
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.calls.filter(call => call.path === '/billing/topups/complete').length, 2);
  assert.equal(f.node('billing-balance').textContent, '$32.34');
  assert.equal(f.storage.size, 0);
});

test('Stripe payment errors stay inline and do not credit balance', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  f.paymentReady(); f.setConfirmationError('Your card was declined.');
  await f.node('checkout-form').submit(); await tick();
  assert.equal(f.node('checkout-status').textContent, 'Your card was declined.');
  assert.equal(f.node('checkout-submit').disabled, false);
  assert.equal(f.node('checkout-submit').textContent, 'Pay $20.00');
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.calls.some(call => call.path === '/billing/topups/complete'), false);
  assert.deepEqual(mocks.billingTracking, []);
});

test('duplicate payment submits and closing the form are blocked during charging', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  f.paymentReady();
  let release!: () => void;
  f.setConfirmGate(new Promise(resolve => { release = resolve; }));
  const payment = f.node('checkout-form').submit(); await tick();
  await f.node('checkout-form').submit();
  await f.node('checkout-back').click();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.node('checkout-back').disabled, true);
  assert.equal(f.node('usage-save').disabled, true);
  assert.equal(f.node('inline-checkout').hidden, false);
  release(); await payment; await tick();
  assert.equal(f.node('inline-checkout').hidden, true);
  assert.equal(f.node('usage-save').disabled, false);
});

test('closing an unpaid form preserves its purchase identity when reopened', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  const initial = f.calls.find(call => call.path === '/billing/topups')!.body;
  await f.node('checkout-back').click();
  assert.equal(f.isDestroyed(), true);
  assert.equal(f.node('inline-checkout').hidden, true);
  assert.equal(f.node('topup-submit').disabled, false);
  await f.node('topup-form').submit(); await tick();
  assert.deepEqual(f.calls.filter(call => call.path === '/billing/topups').map(call => call.body), [initial, initial]);
  assert.equal(f.confirmations.length, 0);
});

test('switching accounts while Stripe loads cannot mount the old account form', async t => {
  let release!: () => void;
  const f = await fixture(t, { stripeGate: new Promise<void>(resolve => { release = resolve; }) });
  await f.node('topup-form').submit();
  f.changeAccount({ id: 'next-owner' }); await tick();
  release(); await tick();
  assert.equal(f.isMounted(), false);
  assert.equal(f.node('inline-checkout').hidden, true);
});

test('switching accounts during verification clears old payment state and ignores its result', async t => {
  const f = await fixture(t);
  await f.node('topup-form').submit(); await tick();
  f.paymentReady();
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const payment = f.node('checkout-form').submit(); await tick();
  f.changeAccount({ id: 'next-owner' }); await tick();
  release(); await payment; await tick();
  assert.equal(f.node('billing-balance').textContent, '$12.34');
  assert.equal(f.node('inline-checkout').hidden, true);
  assert.equal(f.node('topup-submit').disabled, false);
  assert.deepEqual(mocks.billingTracking, []);
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

test('switching accounts during top-up creation prevents stale checkout mounting', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const payment = f.node('topup-form').submit();
  await tick();
  f.changeAccount({ id: 'next-owner' });
  release(); await payment; await tick();
  assert.deepEqual(f.redirects, []);
  assert.equal(f.isMounted(), false);
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
