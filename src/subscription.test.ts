import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const checkoutGlobal = globalThis as typeof globalThis & { checkoutOptions: { onComplete: (session: { id: string }) => Promise<void>; onReady: () => void; onError: () => void } };

// Exercise the real billing client; replace only browser and Stripe boundaries.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const mocks: Record<string, string> = {
      './payments/stripeEmbeddedCheckout.ts': 'export const mountStripeEmbeddedCheckout = options => { globalThis.checkoutOptions = options; return () => {}; };',
      './auth.ts': "export const API_ORIGIN = 'https://api.test'; export const createAuthClient = () => ({ signOut: async () => {} });",
    };
    if (Object.hasOwn(mocks, specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
    return next(specifier, context);
  },
});
let sequence = 0;
// Partial DOM double; dynamic fields are set by the billing client.
class Element {
  [key: string]: any;
  hidden = true; disabled = false; dataset: Record<string, string> = {}; textContent = ''; listeners = new Map();
  addEventListener(type: string, handler: (event?: any) => unknown) { this.listeners.set(type, handler); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.(); }
  focus() {}
  reportValidity() { return true; }
  async submit() { await this.listeners.get("submit")?.({ preventDefault() {} }); }
}
async function fixture(t: TestContext, current: string | null = 'builder', target = 'pro', extra: Record<string, any> = {}) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const button = node('[data-plan]'); button.dataset.plan = target;
  const redirects: string[] = []; const calls: { path: string; body: any }[] = []; const confirmations: string[] = [];
  const events = new Map();
  let accept = true; let fail: string | null = null; let gate: Promise<void> | null = null; let failRead = Boolean(extra.failRead);
  let state: Record<string, any> = { plan: current, active: true, valid_until: Date.UTC(2026, 10, 5),
    subscription: { id: 'sub_owned', cancel_at_period_end: false }, ...extra };
  const property = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  };
  property('document', { querySelector: node, querySelectorAll: (selector: string) => selector === '[data-plan]' ? [button] : [] });
  property('location', { pathname: extra.pathname || `/pricing/${target}`, search: extra.search || '', hash: '', assign: (value: string) => redirects.push(value) });
  property('history', { replaceState() {} });
  property('checkoutOptions', null);
  property('window', { localStorage: { getItem: () => extra.cookieChoice || 'accepted' }, addEventListener: (type: string, handler: (event: any) => unknown) => events.set(type, handler),
    dispatchEvent: (event: Event) => events.get(event.type)?.(event), confirm: (value: string) => { confirmations.push(value); return accept; } });
  property('fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options!.body as string) : null;
    calls.push({ path, body });
    if (path === '/subscription/config') return Response.json({ configured: true });
    if (path === '/auth/me') { if (extra.sessionGate) await extra.sessionGate;
      return extra.authFailure ? Response.json({ error: 'auth_unavailable' }, { status: 503 })
        : Response.json({ user: { id: 'owner', email: 'owner@example.com' } }); }
    if (path === '/subscription') { if (extra.loadGate) await extra.loadGate;
      return failRead ? Response.json({ error: 'billing_unavailable' }, { status: 503 }) : Response.json(state); }
    if (gate) await gate;
    if (fail && (!extra.failPath || extra.failPath === path)) return Response.json({ error: fail }, { status: 409 });
    if (path === '/subscription/checkout') return Response.json({ client_secret: 'cs_owned_secret', publishable_key: 'pk_mock' });
    if (path === '/subscription/complete') {
      state = { plan: target, active: true, valid_until: Date.UTC(2026, 10, 5), subscription: { id: 'sub_owned', cancel_at_period_end: false } };
      return Response.json(state);
    }
    if (path === '/subscription/portal') return Response.json({ url: 'https://billing.stripe.com/p/session_owned' });
    if (path === '/subscription/change') {
      state = { ...state, scheduled_plan: body.plan === state.plan ? null : body.plan,
        scheduled_change_at: Math.floor(state.valid_until / 1000) };
    }
    if (path === '/subscription/cancel') state = { ...state, scheduled_plan: null,
      subscription: { ...state.subscription, cancel_at_period_end: true } };
    if (path === '/subscription/resume') state = { ...state, subscription: { ...state.subscription, cancel_at_period_end: false } };
    return Response.json({ ok: true });
  });
  await import(`./subscription.ts?test=${++sequence}`);
  await new Promise(resolve => setImmediate(resolve));
  return { button, node, calls, redirects, confirmations, setAccept(value: boolean) { accept = value; },
    setFail(value: string | null) { fail = value; }, setGate(value: Promise<void> | null) { gate = value; },
    setReadFailure(value: boolean) { failRead = value; },
    signOutExternally() { events.get('auth-change')?.({ detail: { user: null } }); } };
}

test('Builder upgrade sends the chosen Pro plan to Stripe hosted confirmation', async t => {
  const f = await fixture(t);
  assert.match(f.button.textContent, /Upgrade to Pro/);
  await f.button.click();
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/portal')!.body, { plan: 'pro' });
  assert.deepEqual(f.redirects, ['https://billing.stripe.com/p/session_owned']);
  assert.equal(f.node('#billing-cancel').disabled, true);
});

test('downgrade requires confirmation and retains the current plan until renewal', async t => {
  const f = await fixture(t, 'pro', 'builder');
  f.setAccept(false); await f.button.click();
  assert.equal(f.calls.filter(call => call.path === '/subscription/change').length, 0);
  f.setAccept(true); await f.button.click();
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/change')!.body, { plan: 'builder', confirm: true });
  assert.match(f.node('#pro-status').textContent, /next renewal/);
  assert.match(f.confirmations[0], /\$180\/month.*\$5\/month/);
});

test('Keep current plan withdraws an existing scheduled downgrade', async t => {
  const f = await fixture(t, 'pro', 'pro', { scheduled_plan: 'builder', scheduled_change_at: 1793836800 });
  assert.equal(f.button.textContent, 'Keep Pro');
  await f.button.click();
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/change')!.body, { plan: 'pro', confirm: true });
  assert.equal(f.button.disabled, true);
  assert.match(f.node('#pro-status').textContent, /Scheduled plan change canceled/);
});

test('cancellation shows the paid-through date, disables concurrent actions, and can be resumed', async t => {
  const f = await fixture(t);
  let release!: () => void; f.setGate(new Promise<void>(resolve => { release = resolve; }));
  const pending = f.node('#billing-cancel').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.button.disabled, true);
  assert.equal(f.node('#billing-manage').disabled, true);
  assert.equal(f.node('#billing-cancel').disabled, true);
  assert.equal(f.node('#pro-logout').disabled, true);
  release(); await pending; f.setGate(null);
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/cancel')!.body, { confirm: true });
  assert.match(f.confirmations[0], /Nov.*2026/);
  assert.match(f.node('#pro-status').textContent, /subscription ends on/);
  assert.equal(f.node('#billing-cancel').hidden, true);
  assert.equal(f.node('#billing-resume').hidden, false);
  await f.node('#billing-resume').click();
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/resume')!.body, {});
  assert.equal(f.node('#billing-cancel').hidden, false);
  assert.match(f.node('#pro-status').textContent, /continue renewing/);
});

test('failed billing mutations restore controls and show a readable pending-operation error', async t => {
  const f = await fixture(t, 'pro', 'builder'); f.setFail('billing_operation_pending');
  await f.button.click();
  assert.equal(f.button.disabled, false);
  assert.equal(f.node('#billing-cancel').disabled, false);
  assert.match(f.node('#pro-status').textContent, /Another billing change is in progress/);
  assert.equal(f.node('#pro-status').dataset.state, 'error');
});

test('inactive subscriptions expose payment management and cancellation without granting a plan change', async t => {
  const f = await fixture(t, 'pro', 'builder', { active: false });
  assert.equal(f.button.disabled, true);
  assert.equal(f.node('#billing-manage').hidden, false);
  assert.equal(f.node('#billing-cancel').hidden, false);
  await f.node('#billing-manage').click();
  assert.deepEqual(f.calls.find(call => call.path === '/subscription/portal')!.body, {});
});

test('opening payment management disables every billing action until failure restores the controls', async t => {
  const f = await fixture(t);
  let release!: () => void; f.setGate(new Promise<void>(resolve => { release = resolve; }));
  f.setFail('billing_unavailable');
  const pending = f.node('#billing-manage').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.button.disabled, true);
  assert.equal(f.node('#billing-cancel').disabled, true);
  assert.equal(f.node('#billing-manage').disabled, true);
  assert.equal(f.node('#pro-logout').disabled, true);
  release(); await pending;
  assert.equal(f.node('#billing-cancel').disabled, false);
  assert.equal(f.node('#billing-manage').disabled, false);
  assert.match(f.node('#pro-status').textContent, /Unable to open billing/);
});

test('an expired billing session clears the cached current plan and exposes sign-in', async t => {
  const f = await fixture(t, 'builder', 'builder'); f.setFail('not_authenticated');
  assert.equal(f.button.disabled, true);
  await f.node('#billing-manage').click();
  assert.equal(f.button.disabled, false);
  assert.match(f.button.textContent, /Subscribe to Builder/);
  assert.equal(f.node('#billing-manage').hidden, true);
  assert.equal(f.node('#billing-cancel').hidden, true);
  assert.equal(f.node('#pro-login').hidden, false);
  assert.match(f.node('#pro-status').textContent, /sign in again/);
});

test('billing changes stay disabled until the current subscription is loaded', async t => {
  let release!: () => void; const loadGate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, 'builder', 'pro', { loadGate });
  assert.equal(f.button.disabled, true);
  assert.equal(f.node('#billing-manage').disabled, true);
  await f.button.click();
  assert.equal(f.calls.filter(call => call.path === '/subscription/portal').length, 0);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.button.disabled, false);
  assert.match(f.button.textContent, /Upgrade to Pro/);
});

test('inactive cancellation does not promise active access and uses the subscription item renewal date', async t => {
  const f = await fixture(t, 'pro', 'builder', { active: false, valid_until: null,
    subscription: { id: 'sub_owned', cancel_at_period_end: false, items: { data: [{ current_period_end: Date.UTC(2026, 10, 5) / 1000 }] } } });
  await f.node('#billing-cancel').click();
  assert.match(f.confirmations[0], /Nov.*2026/);
  assert.doesNotMatch(f.confirmations[0], /stays active/);
});

test('session lookup failures show an unavailable state instead of pretending the account is signed out', async t => {
  const f = await fixture(t, 'builder', 'pro', { authFailure: true });
  assert.match(f.node('#pro-status').textContent, /temporarily unavailable/);
  assert.equal(f.node('#pro-status').dataset.state, 'error');
  assert.equal(f.calls.filter(call => call.path === '/subscription/checkout').length, 0);
  assert.equal(f.calls.filter(call => call.path === '/subscription').length, 0);
  assert.deepEqual(f.redirects, []);
});

test('successful payment applies the verified completion state without a second billing lookup', async t => {
  const f = await fixture(t, null, 'pro', { active: false, subscription: null });
  const reads = f.calls.filter(call => call.path === '/subscription').length;
  assert.ok(checkoutGlobal.checkoutOptions);
  f.setReadFailure(true);
  await checkoutGlobal.checkoutOptions.onComplete({ id: 'cs_owned' });
  assert.equal(f.calls.filter(call => call.path === '/subscription').length, reads);
  assert.match(f.node('#pro-status').textContent, /Pro subscription is active/);
  assert.match(f.button.textContent, /Current plan/);
  assert.equal(f.button.disabled, true);
  assert.equal(f.node('#billing-manage').hidden, false);
  assert.equal(f.node('#inline-checkout').hidden, true);
});

test('checkout keeps its form visible while authentication and billing load', async t => {
  let release!: () => void;
  const sessionGate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, null, 'pro', { active: false, subscription: null, sessionGate });
  assert.equal(f.node('#pricing-plans').hidden, true);
  assert.equal(f.node('#inline-checkout').hidden, false);
  assert.equal(f.node('#checkout-form').hidden, false);
  assert.equal(f.node('#checkout-email').disabled, true);
  assert.equal(f.node('#checkout-submit').disabled, true);
  assert.equal(f.node('#checkout-payment-slot').dataset.loading, 'true');
  assert.equal(f.node('#checkout-title').textContent, 'Pro — $180/month');
  assert.equal(checkoutGlobal.checkoutOptions, null);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.node('#checkout-form').hidden, false);
  assert.equal(f.node('#checkout-payment-slot').dataset.loading, 'true');
  assert.ok(checkoutGlobal.checkoutOptions);
});

test('the payment placeholder stays until ready and ignores callbacks from closed checkout', async t => {
  const f = await fixture(t, null, 'pro', { active: false, subscription: null });
  const options = checkoutGlobal.checkoutOptions;
  const slot = f.node('#checkout-payment-slot');
  assert.equal(slot.dataset.loading, 'true');
  options.onReady();
  assert.equal(slot.dataset.loading, 'false');
  assert.equal(slot.ariaBusy, 'false');
  f.signOutExternally();
  assert.equal(slot.dataset.loading, 'true');
  options.onReady();
  options.onError();
  assert.equal(slot.dataset.loading, 'true');
  assert.equal(f.node('#inline-checkout').hidden, true);
});

test('returning from payment applies completion state even when subscription lookup is unavailable', async t => {
  const f = await fixture(t, null, 'scale', { active: false, subscription: null, failRead: true,
    search: '?subscription_return=1&session_id=cs_owned' });
  assert.equal(f.calls.filter(call => call.path === '/subscription/complete').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/subscription').length, 0);
  assert.equal(f.calls.filter(call => call.path === '/subscription/checkout').length, 0);
  assert.match(f.node('#pro-status').textContent, /Scale subscription is active/);
  assert.match(f.button.textContent, /Current plan/);
  assert.equal(f.button.disabled, true);
});

for (const gate of ['sessionGate', 'loadGate']) {
  test(`signing out during ${gate === 'sessionGate' ? 'account' : 'subscription'} loading cannot restore stale billing state`, async t => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(t, 'builder', 'pro', { [gate]: pending });
    f.signOutExternally(); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.node('#pro-account').textContent, '');
    assert.equal(f.node('#billing-manage').hidden, true);
    assert.equal(f.node('#billing-cancel').hidden, true);
    assert.equal(f.node('#pro-login').hidden, false);
    assert.equal(f.button.disabled, false);
    assert.match(f.button.textContent, /Subscribe to Pro/);
    assert.equal(f.node('#pro-status').textContent, 'Signed out.');
    assert.deepEqual(f.redirects, []);
  });
}

for (const action of ['upgrade', 'manage', 'downgrade', 'cancel', 'resume']) {
  test(`signing out while ${action} is pending ignores its response and never redirects or restores the account`, async t => {
    const f = await fixture(t, action === 'downgrade' ? 'pro' : 'builder', action === 'downgrade' ? 'builder' : 'pro',
      action === 'resume' ? { subscription: { id: 'sub_owned', cancel_at_period_end: true } } : {});
    let release!: () => void; f.setGate(new Promise<void>(resolve => { release = resolve; }));
    const control = action === 'upgrade' || action === 'downgrade' ? f.button
      : f.node(`#billing-${action}`);
    const pending = control.click(); await new Promise(resolve => setImmediate(resolve));
    f.signOutExternally(); release(); await pending;
    assert.equal(f.node('#pro-account').textContent, '');
    assert.equal(f.node('#billing-manage').hidden, true);
    assert.equal(f.node('#billing-cancel').hidden, true);
    assert.equal(f.node('#billing-resume').hidden, true);
    assert.equal(f.node('#pro-login').hidden, false);
    assert.equal(f.node('#pro-status').textContent, 'Signed out.');
    assert.deepEqual(f.redirects, []);
  });
}

test('pricing overview shows billing controls and navigates to checkout without mounting Stripe', async t => {
  const f = await fixture(t, 'builder', 'pro', { pathname: '/pricing/' });
  assert.equal(f.node('#billing-manage').hidden, false);
  assert.equal(f.node('#billing-cancel').hidden, false);
  assert.equal(checkoutGlobal.checkoutOptions, null);
  await f.button.click();
  assert.deepEqual(f.redirects, ['/pricing/pro']);
  assert.equal(f.calls.filter(call => call.path === '/subscription/checkout').length, 0);
});

test('checkout Back to plans returns to pricing', async t => {
  const f = await fixture(t);
  await f.node('#checkout-back').click();
  assert.deepEqual(f.redirects, ['/pricing/']);
});


test('rejected visitors can browse pricing without authentication cookies or checkout', async t => {
  const f = await fixture(t, null, 'builder', { pathname: '/pricing/', cookieChoice: 'rejected' });
  assert.equal(f.calls.some(call => call.path === '/auth/me'), false);
  assert.equal(f.calls.some(call => call.path === '/subscription'), false);
  assert.equal(checkoutGlobal.checkoutOptions, null);
  assert.match(f.node('#pro-status').textContent, /Change your cookie choice/);
  await f.button.click();
  assert.deepEqual(f.redirects, ['/pricing/builder']);
});

test('rejected visitors opening a checkout route go to login before Stripe mounts', async t => {
  const f = await fixture(t, null, 'builder', { cookieChoice: 'rejected' });
  assert.equal(f.calls.some(call => call.path === '/auth/me'), false);
  assert.equal(checkoutGlobal.checkoutOptions, null);
  assert.deepEqual(f.redirects, ['/login?returnTo=%2Fpricing%2Fbuilder']);
});

test.after(() => hooks.deregister());
