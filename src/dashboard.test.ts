import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { ContainerData, PrepaidBalance, User } from './types.ts';

const shared = globalThis as typeof globalThis & {
  dashboardSession: () => Promise<{ user: User } | null>;
  dashboardContainerOptions: { onData: (data: ContainerData) => void };
  dashboardLoads: number;
  dashboardDisposals: number;
};
registerHooks({ resolve(specifier, context, next) {
  const mocks: Record<string, string> = {
    './auth.ts': "export const API_ORIGIN='https://api.test';export const createAuthClient=()=>({readSession:()=>globalThis.dashboardSession()});",
    './containers-dashboard.ts': 'export const createContainersDashboard=options=>{globalThis.dashboardContainerOptions=options;return{load(){globalThis.dashboardLoads++},dispose(){globalThis.dashboardDisposals++},setImages(){},selectImage(){}}}',
    './images-dashboard.ts': 'export const createImagesDashboard=()=>({load(){},dispose(){globalThis.dashboardDisposals++}});',
    './acquisition-analytics.ts': 'export const trackFunnel=()=>{};',
  };
  if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
  return next(specifier, context);
} });
class Element {
  hidden = false; disabled = false; textContent = ''; href = ''; className = ''; attributes = new Map<string, string>(); listeners = new Map<string, () => unknown>();
  addEventListener(type: string, handler: () => unknown) { this.listeners.set(type, handler); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.(); }
}
const balance = (balanceCents = 2000): PrepaidBalance => ({ balanceCents, availableBalanceCents: Math.max(balanceCents, 0), reservedBalanceCents: 0,
  currency: 'usd', spendLimitCents: 18000, monthlyUsageCents: 0, productionHourlyCents: 0, fundedRuntimeMs: null,
  minimumProductionRuntimeMs: 86400000, autoRecharge: { enabled: false, amountCents: 500, monthlyLimitCents: 500, spentCents: 0, status: 'disabled' } });
let sequence = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t: TestContext, extra: Record<string, any> = {}) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const events = new Map<string, (event: any) => void>(); const published: any[] = [];
  const redirects: string[] = []; const calls: string[] = []; let reloads = 0;
  let failure = Boolean(extra.failure);
  const property = (name: string, value: any) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  };
  const location = { search: extra.search || '', pathname: '/dashboard/', hash: '', replace: (path: string) => redirects.push(path), reload: () => { reloads++; } };
  property('location', location);
  property('document', { querySelector: node, querySelectorAll: () => [] });
  property('window', { location, addEventListener: (type: string, handler: (event: any) => void) => events.set(type, handler),
    dispatchEvent(event: any) { published.push(event); events.get(event.type)?.(event); } });
  shared.dashboardSession = async () => extra.signedOut ? null : { user: { id: 'owner' } };
  shared.dashboardLoads = 0; shared.dashboardDisposals = 0;
  property('fetch', async (url: string, options: RequestInit) => {
    calls.push(new URL(url).pathname); assert.equal(options.credentials, 'include');
    if (extra.gate) await extra.gate;
    return failure ? Response.json({ error: 'billing_unavailable' }, { status: 503 }) : Response.json({ balance: balance(extra.balanceCents ?? 2000) });
  });
  await import(`./dashboard.ts?test=${++sequence}`); await tick();
  return { node, calls, published, redirects, events, reloads: () => reloads, setFailure(value: boolean) { failure = value; } };
}

test('dashboard reads prepaid balance and links billing while workloads load independently', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.calls, ['/billing/balance']);
  assert.equal(f.node('#subscription-level').textContent, 'Prepaid balance $20.00');
  assert.equal(f.node('#subscription-manage').href, '/pricing/');
  assert.equal(f.node('#subscription-note').hidden, true);
  assert.equal(shared.dashboardLoads, 1);
  assert.equal(f.published.find(event => event.type === 'billing-balance-change')?.detail.userId, 'owner');
});

test('an empty wallet offers a one-time top-up with no subscription promise', async t => {
  const f = await fixture(t, { balanceCents: 0 });
  assert.equal(f.node('#subscription-level').textContent, 'Prepaid balance $0.00');
  assert.equal(f.node('#subscription-manage').textContent, 'Add balance');
  assert.match(f.node('#subscription-note').textContent, /Unused funds carry forward/);
  assert.doesNotMatch(f.node('#subscription-note').textContent, /subscription|month/i);
});

test('wallet outage preserves workloads and shows unavailable instead of zero', async t => {
  const f = await fixture(t, { failure: true });
  assert.equal(f.node('#subscription-level').textContent, 'Unavailable');
  assert.equal(f.node('#dashboard-content').hidden, false);
  assert.match(f.node('#dashboard-error').textContent, /prepaid balance/);
  f.setFailure(false); await f.node('#dashboard-retry').click();
  assert.equal(f.node('#subscription-level').textContent, 'Prepaid balance $20.00');
});

test('signing out ignores a late balance response and clears workload UI', async t => {
  let release!: () => void;
  const f = await fixture(t, { gate: new Promise<void>(resolve => { release = resolve; }) });
  f.events.get('auth-change')?.({ detail: { user: null } });
  release(); await tick();
  assert.equal(f.node('#dashboard-content').hidden, true);
  assert.equal(shared.dashboardDisposals, 2);
  assert.equal(f.published.some(event => event.type === 'billing-balance-change'), false);
});

test('account switch reloads dashboard and invalidates earlier account responses', async t => {
  let release!: () => void;
  const f = await fixture(t, { gate: new Promise<void>(resolve => { release = resolve; }) });
  f.events.get('auth-change')?.({ detail: { user: { id: 'other' } } });
  release(); await tick();
  assert.equal(f.reloads(), 1);
  assert.equal(f.node('#dashboard-content').hidden, true);
  assert.equal(f.published.some(event => event.type === 'billing-balance-change'), false);
});

test('new container ledger data supersedes an earlier funding snapshot', async t => {
  let release!: () => void;
  const f = await fixture(t, { gate: new Promise<void>(resolve => { release = resolve; }) });
  const latest = balance(3456);
  shared.dashboardContainerOptions.onData({ active: true, containers: [],
    limits: { maxContainers: 100, maxStartsPerMonth: 10000, maxSessionMs: 86400000, idleTimeoutMs: 1800000 },
    usage: { starts: 0, computeUnitHours: 0, reservedComputeUnitHours: 0 },
    billing: { ...latest, periodStart: 1, periodEnd: 2, computeUnitHours: 0, estimatedCents: 0, minimumCents: 0,
      committedCents: 0, alert: null, overagesEnabled: false, invoicingPending: false } });
  release(); await tick();
  assert.equal(f.node('#subscription-level').textContent, 'Prepaid balance $34.56');
});
