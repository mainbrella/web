import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readBalanceHistory, formatRuntimeCost, formatRuntime, type BalanceHistory, type BalanceResource } from './balance-history-data.ts';
import type { User } from './types.ts';

const session = globalThis as typeof globalThis & { historyTestSession: () => Promise<{ user: User } | null> };
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './auth.ts') return { url: `data:text/javascript,${encodeURIComponent("export const API_ORIGIN='https://api.test';export const createAuthClient=()=>({readSession:()=>globalThis.historyTestSession()});")}`, shortCircuit: true };
  return next(specifier, context);
} });

const now = Date.UTC(2026, 9, 9, 12);
const resource = (extra: Partial<BalanceResource> = {}): BalanceResource => ({ id: 'allocation-1', containerId: 'small', name: 'API worker',
  lifecycle: 'production', size: 'small', startAt: now - 3600000, endAt: null, runtimeMs: 3600000,
  computeUnitHours: 6, usedCents: 12, reservedCents: 1, hourlyCents: 12, active: true, ...extra });
const history = (extra: Partial<BalanceHistory> = {}): BalanceHistory => ({ asOf: now,
  balance: { balanceCents: 887, availableBalanceCents: 886, reservedBalanceCents: 1, currency: 'usd',
    spendLimitCents: 500, monthlyUsageCents: 13, productionHourlyCents: 12, fundedRuntimeMs: 86400000,
    minimumProductionRuntimeMs: 86400000, autoRecharge: { enabled: false, amountCents: 500, monthlyLimitCents: 500, spentCents: 0, status: 'disabled' } },
  totals: { fundedCents: 1000, revokedCents: 100, usedCents: 12.5, unattributedUsedCents: 0.5 },
  currentHourlyCents: 12, activeResources: [resource()], resources: [],
  fundings: [{ id: 'pi_added', createdAt: now - 86400000, amountCents: 1000, revokedCents: 100, reason: 'refund' }],
  nextResourceCursor: null, nextFundingCursor: null, historyTruncated: true, retainedResourceLimit: 256, ...extra });

test('history validates fractional consumption, reversals and negative balances without inventing cents', () => {
  assert.equal(readBalanceHistory(history()).totals.usedCents, 12.5);
  const negative = history();
  negative.totals.revokedCents = 1000;
  negative.balance.balanceCents = -13;
  negative.balance.availableBalanceCents = 0;
  assert.equal(readBalanceHistory(negative).balance.balanceCents, -13);
  for (const mutate of [
    (data: BalanceHistory) => { data.balance.balanceCents = 999; },
    (data: BalanceHistory) => { data.totals.usedCents = NaN; },
    (data: BalanceHistory) => { data.totals.unattributedUsedCents = 13; },
    (data: BalanceHistory) => { data.activeResources[0].runtimeMs = -1; },
    (data: BalanceHistory) => { data.fundings[0].revokedCents = 1001; },
    (data: BalanceHistory) => { data.activeResources[0].startAt = Infinity; },
  ]) {
    const invalid = history(); mutate(invalid);
    assert.throws(() => readBalanceHistory(invalid));
  }
});

test('runtime formatting makes small charges visible and expresses elapsed allocation', () => {
  assert.equal(formatRuntimeCost(0.5), '$0.0050');
  assert.equal(formatRuntimeCost(0.00001), '<$0.0001');
  assert.equal(formatRuntimeCost(12), '$0.1200');
  assert.equal(formatRuntime(0), '0 sec');
  assert.equal(formatRuntime(500), '<1 sec');
  assert.equal(formatRuntime(3660000), '1 hr 1 min');
});

class Element {
  hidden = false; disabled = false; textContent = ''; className = ''; href = ''; type = '';
  parentElement?: Element;
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: unknown) => unknown>();
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.children.push(child); return child; }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(type: string, handler: (event: unknown) => unknown) { this.listeners.set(type, handler); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.({}); }
}

let sequence = 0;
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t: TestContext, options: { signedOut?: boolean; sessionError?: boolean } = {}) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  node('#history-resources-table').parentElement = new Element();
  node('#history-fundings-table').parentElement = new Element();
  node('#history-content').hidden = true;
  const events = new Map<string, (event: { detail: unknown }) => unknown>();
  const published: { type: string; detail: unknown }[] = [];
  const redirects: string[] = [];
  const calls: { url: URL; options: RequestInit }[] = [];
  let respond: (url: URL) => Response | Promise<Response> = () => Response.json(history());
  const replace = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  const location = { pathname: '/balance/', search: '', hash: '', replace: (url: string) => redirects.push(url), reload: () => redirects.push('reload') };
  replace('document', { querySelector: node, createElement: () => new Element() });
  replace('location', location);
  replace('window', { location, addEventListener: (type: string, handler: (event: { detail: unknown }) => unknown) => events.set(type, handler),
    dispatchEvent: (event: { type: string; detail: unknown }) => { published.push(event); return events.get(event.type)?.(event); } });
  session.historyTestSession = async () => {
    if (options.sessionError) throw new Error('session unavailable');
    return options.signedOut ? null : { user: { id: 'owner' } };
  };
  replace('fetch', async (url: string, options: RequestInit) => {
    const parsed = new URL(url); calls.push({ url: parsed, options });
    return respond(parsed);
  });
  await import(`./balance-history.ts?test=${++sequence}`); await flush();
  return { node, calls, redirects, published, flush,
    respond(handler: typeof respond) { respond = handler; },
    changeAccount(user: User | null) { events.get('auth-change')?.({ detail: { user } }); },
  };
}

const contents = (element: Element): string => [element.textContent, ...element.children.map(contents)].join(' ');

test('Storage and Git renders compact usage details, funded dates and signed invoice credits, then clears on sign-out', async t => {
  const f = await fixture(t);
  f.respond(() => Response.json(history({ storage: { month: '2026-10', maxBytes: 2000000000000,
    pricing: { mode: 'charge', markupBps: 2000, chargeFrom: now - 86400000, retentionDays: 7, storageUsdPerGbMonth: 0.015, classAUsdPerMillion: 4.5, classBUsdPerMillion: 0.36 },
    projects: [{ appId: 'example', name: '<script>Example app</script>', storedBytes: 1000000000000, sourceAssetsBytes: 500000000000, historyBytes: 500000000000,
      chargedCents: 600, estimatedMonthlyCents: 1800, cloudflareCents: 500, markupCents: 100, adjustmentCents: -100,
      reads: 300, writes: 20, fundedThrough: now + 86400000, writesBlocked: true }] } })));
  await f.node('#history-refresh').click(); await f.flush();
  assert.equal(f.node('#history-storage-section').hidden, false);
  assert.match(contents(f.node('#history-storage')), /1 TB/);
  assert.match(contents(f.node('#history-storage')), /18\.0000/);
  assert.match(contents(f.node('#history-storage')), /500 GB/);
  assert.match(contents(f.node('#history-storage')), /-\$1\.0000/);
  assert.match(contents(f.node('#history-storage')), /Read-only/);
  assert.match(f.node('#history-storage-pricing').textContent, /0\.018\/GB-month/);
  f.changeAccount(null); await f.flush();
  assert.equal(f.node('#history-storage-section').hidden, true);
  assert.equal(f.node('#history-storage').children.length, 0);
});

test('the page explains balance changes, allocated resources and older unattributed usage', async t => {
  const f = await fixture(t);
  assert.equal(f.calls[0].url.pathname, '/billing/history');
  assert.equal(f.calls[0].options.credentials, 'include');
  assert.equal(f.node('#history-content').hidden, false);
  assert.equal(f.node('#history-balance').textContent, '$8.87');
  assert.match(f.node('#history-used').textContent, /0\.1250/);
  assert.match(f.node('#history-activity').textContent, /0\.12/);
  assert.match(contents(f.node('#history-resources')), /API worker/);
  assert.match(contents(f.node('#history-resources')), /0\.1200/);
  assert.match(contents(f.node('#history-fundings')), /Refund/);
  assert.match(f.node('#history-unattributed').textContent, /0\.0050/);
  assert.ok(f.published.some(event => event.type === 'billing-balance-change' && (event.detail as { userId: string }).userId === 'owner'));
});

test('signed-out and failed session reads do not fetch account history', async t => {
  const f = await fixture(t, { signedOut: true });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fbalance%2F']);
});

test('an unavailable session offers a retry without showing a zero balance', async t => {
  const f = await fixture(t, { sessionError: true });
  assert.equal(f.calls.length, 0);
  assert.equal(f.node('#history-error').hidden, false);
  assert.equal(f.node('#history-retry').hidden, false);
  assert.equal(f.node('#history-content').hidden, true);
});

test('refresh failure preserves the verified snapshot and refresh can recover', async t => {
  const f = await fixture(t);
  f.respond(() => Response.json({ error: 'billing_unavailable' }, { status: 503 }));
  await f.node('#history-refresh').click(); await f.flush();
  assert.equal(f.node('#history-balance').textContent, '$8.87');
  assert.equal(f.node('#history-error').hidden, false);
  f.respond(() => Response.json(history()));
  await f.node('#history-refresh').click(); await f.flush();
  assert.equal(f.node('#history-error').hidden, true);
});

test('pagination appends only the requested history and preserves retryable cursors after failure', async t => {
  const f = await fixture(t);
  f.respond(() => Response.json(history({ nextResourceCursor: 'older-resource', nextFundingCursor: 'older-funding' })));
  await f.node('#history-refresh').click(); await f.flush();
  f.respond(() => Response.json({ error: 'unavailable' }, { status: 503 }));
  await f.node('#history-resources-more').click(); await f.flush();
  assert.match(f.node('#history-resources-status').textContent, /try|load|retry/i);
  assert.equal(f.node('#history-resources-more').disabled, false);
  f.respond(url => Response.json(history({
    resources: [resource({ id: 'allocation-older', containerId: 'c1', name: 'Old worker', active: false, endAt: now - 1000 })],
    fundings: [{ id: 'pi_other', createdAt: now - 172800000, amountCents: 500, revokedCents: 0, reason: null }],
    nextFundingCursor: 'should-not-replace-current-cursor',
  })));
  await f.node('#history-resources-more').click(); await f.flush();
  assert.equal(f.calls.at(-1)?.url.searchParams.get('resourceCursor'), 'older-resource');
  assert.equal(f.calls.at(-1)?.url.searchParams.has('fundingCursor'), false);
  assert.match(contents(f.node('#history-resources')), /Old worker/);
  assert.equal(f.node('#history-fundings').children.length, 1);
  await f.node('#history-fundings-more').click(); await f.flush();
  assert.equal(f.calls.at(-1)?.url.searchParams.get('fundingCursor'), 'older-funding');
  assert.equal(f.calls.at(-1)?.url.searchParams.has('resourceCursor'), false);
  assert.equal(f.node('#history-fundings').children.length, 2);
});

test('compacted pagination cursors guide the user to refresh while keeping loaded rows', async t => {
  const f = await fixture(t);
  f.respond(() => Response.json(history({ nextResourceCursor: 'compacted-resource' })));
  await f.node('#history-refresh').click(); await f.flush();
  f.respond(() => Response.json({ error: 'invalid_history_cursor' }, { status: 400 }));
  await f.node('#history-resources-more').click(); await f.flush();
  assert.match(f.node('#history-resources-status').textContent, /Refresh/);
  assert.equal(f.node('#history-resources-more').hidden, true);
  assert.match(contents(f.node('#history-resources')), /API worker/);
  assert.equal(f.node('#history-refresh').disabled, false);
});

test('signing out clears account data and ignores a late refresh response', async t => {
  const f = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.respond(async () => { await gate; return Response.json(history()); });
  const pending = f.node('#history-refresh').click(); await flush();
  f.changeAccount(null);
  release(); await pending; await f.flush();
  assert.equal(f.node('#history-content').hidden, true);
  assert.equal(f.node('#history-resources').children.length, 0);
  assert.equal(f.node('#history-fundings').children.length, 0);
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fbalance%2F']);
  assert.equal(f.published.filter(event => event.type === 'billing-balance-change').length, 1);
});

test('an expired history request clears cached account data before redirecting', async t => {
  const f = await fixture(t);
  f.respond(() => Response.json({ error: 'not_authenticated' }, { status: 401 }));
  await f.node('#history-refresh').click(); await f.flush();
  assert.equal(f.node('#history-content').hidden, true);
  assert.equal(f.node('#history-resources').children.length, 0);
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fbalance%2F']);
});

test('30-day retention warning shows its exact deadline, funding action and owner-scoped exports', async t => {
  const f = await fixture(t);
  const deadline = now + 30 * 86400000;
  f.respond(() => Response.json(history({ storage: { month: '2026-10', maxBytes: 10000000000,
    retention: { writesBlocked: true, deletionAt: deadline, warningDeliveredAt: now, expiredAt: null,
      notice: `Your files are read-only. Download before ${new Date(deadline).toISOString()}.` },
    pricing: { mode: 'charge', markupBps: 2000, chargeFrom: now - 86400000, retentionDays: 30, storageUsdPerGbMonth: 0.015, classAUsdPerMillion: 4.5, classBUsdPerMillion: 0.36 },
    projects: [{ appId: 'example', name: 'Example app', storedBytes: 1000, sourceAssetsBytes: 500, historyBytes: 500,
      chargedCents: 0, estimatedMonthlyCents: 0.01, cloudflareCents: 0, markupCents: 0, adjustmentCents: 0,
      reads: 0, writes: 0, fundedThrough: now + 86400000, writesBlocked: true,
      exportUrl: '/build/apps/example/repository', sourceExportUrl: '/build/apps/example/export' }] } })));
  await f.node('#history-refresh').click(); await f.flush();
  const warning = f.node('#history-storage-warning');
  assert.equal(warning.hidden, false);
  assert.match(contents(warning), new RegExp(new Date(deadline).toISOString().replace(/\./g, '\\.')));
  assert.equal(warning.children.at(-1)!.href, '/pricing/');
  const links = f.node('#history-storage').children[0].children[0].children.filter(child => child.href);
  assert.equal(links.length, 2);
  assert.ok(links[0].href.endsWith('/build/apps/example/repository'));
  assert.ok(links[1].href.endsWith('/build/apps/example/export'));
  f.changeAccount(null); await f.flush();
  assert.equal(warning.hidden, true); assert.equal(warning.children.length, 0);
});
