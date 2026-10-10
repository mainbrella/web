import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const preferences = await readFile(new URL('./cookie-preferences.ts', import.meta.url), 'utf8');
const analytics = await readFile(new URL('./acquisition-analytics.ts', import.meta.url), 'utf8');
const behavior = await readFile(new URL('./acquisition.ts', import.meta.url), 'utf8');
type AnalyticsMethods = Pick<typeof import('./acquisition-analytics.ts'), 'trackFunnel' | 'identifyAccount'
  | 'trackConfirmedPayment' | 'trackMachineStart' | 'campaignParameters' | 'publicPage' | 'returnEvents' | 'firstTouchAttribution'>;
const compile = (source: string, measurementId = 'G-TEST123') => transpileModule(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
  .replace("import.meta.env?.VITE_GA_MEASUREMENT_ID || ''", JSON.stringify(measurementId)),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;

function fixture({ choice = 'accepted', blocked = false, href = 'https://mainbrella.com/e2b-alternative/?utm_source=google&utm_campaign=e2b&creator=alex&api_key=mb_secret', local = new Map<string, string>(), pageBehavior = false, measurementId = 'G-TEST123' } = {}) {
  local.set('mainbrella-cookie-consent', choice);
  const session = new Map<string, string>();
  const storage = (data: Map<string, string>) => ({
    getItem(key: string) { if (blocked && key !== 'mainbrella-cookie-consent') throw new Error('blocked'); return data.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error('blocked'); data.set(key, value); },
  });
  const calls: unknown[][] = [];
  const scripts: unknown[] = [];
  const windowEvents = new Map<string, () => void>();
  const documentEvents = new Map<string, () => void>();
  let now = 100;
  let timer: { handler: () => void; delay: number } | null = null;
  let localStorageGetterBlocked = false;
  const window = { location: new URL(href), localStorage: storage(local), sessionStorage: storage(session),
    gtag: (...args: unknown[]) => calls.push(args),
    addEventListener(type: string, handler: () => void) { windowEvents.set(type, handler); } };
  Object.defineProperty(window, 'localStorage', { get() { if (localStorageGetterBlocked) throw new Error('blocked getter'); return storage(local); } });
  const document = { referrer: 'https://example.com/path?credential=secret', visibilityState: 'visible',
    querySelector: () => null, createElement: () => ({}), head: { append: (script: unknown) => scripts.push(script) },
    addEventListener(type: string, handler: () => void) { documentEvents.set(type, handler); } };
  const context = { window, document, location: window.location, URL, Date, performance: { now: () => now },
    setTimeout(handler: () => void, delay: number) { timer = { handler, delay }; return 1; }, clearTimeout() { timer = null; } };
  const methods = runInNewContext(compile(preferences + '\n' + analytics + (pageBehavior ? '\n' + behavior : ''), measurementId)
    + '\n({trackFunnel,identifyAccount,trackConfirmedPayment,trackMachineStart,campaignParameters,publicPage,returnEvents,firstTouchAttribution})', context) as AnalyticsMethods;
  return { ...methods, calls, scripts, local, session, window, document,
    events: () => calls.filter(call => call[0] === 'event'), timer: () => timer,
    advance(ms: number) { now += ms; }, fireTimer() { const handler = timer?.handler; timer = null; handler?.(); },
    choice(value: string) { local.set('mainbrella-cookie-consent', value); windowEvents.get('cookie-consent-change')?.(); },
    blockLocalStorageGetter() { localStorageGetterBlocked = true; session.set('mainbrella-cookie-consent', 'accepted'); },
    visibility(value: string) { document.visibilityState = value; documentEvents.get('visibilitychange')?.(); },
  };
}

test('unknown and rejected consent never create attribution, initialize analytics, or send events', () => {
  for (const choice of ['', 'rejected']) {
    const f = fixture({ choice });
    f.trackFunnel('page_view'); f.identifyAccount('user-one'); f.trackMachineStart('lite'); f.trackConfirmedPayment('session', 'builder');
    assert.equal(f.calls.length, 0); assert.equal(f.scripts.length, 0); assert.equal(f.local.size, 1);
  }
});

test('campaign attribution survives navigation and strips credentials, email values and raw referrer queries', () => {
  const f = fixture();
  f.trackFunnel('page_view');
  const config = f.calls.find(call => call[0] === 'config')?.[2] as Record<string, unknown>;
  assert.equal(config.page_location, 'https://mainbrella.com/e2b-alternative/');
  assert.equal(config.page_referrer, 'https://example.com/path');
  f.window.location = new URL('https://mainbrella.com/login/?returnTo=%2Fpricing%2Fbuilder');
  f.trackFunnel('login', { method: 'email' });
  const data = f.events().at(-1)?.[2] as Record<string, unknown>;
  assert.equal(data.entry_page, '/e2b-alternative/'); assert.equal(data.creator, 'alex'); assert.equal(data.utm_source, 'google');
  assert.ok(!JSON.stringify(f.calls).includes('secret')); assert.ok(!JSON.stringify(f.calls).includes('returnTo'));
  assert.equal(Object.keys(f.campaignParameters(new URL('https://mainbrella.com/?creator=a@example.com&utm_content=mb_secret!'))).length, 0);
});

test('backend first-touch snapshot keeps allowlisted campaign and click IDs through same-tab sign-in', () => {
  const f = fixture({ href: 'https://mainbrella.com/e2b-alternative/?utm_source=google&utm_campaign=e2b&gclid=Click_123&fbclid=bad%20value' });
  f.trackFunnel('page_view');
  f.window.location = new URL('https://mainbrella.com/login/?returnTo=%2Frun%2F&email=user%40example.com');
  const firstTouch = f.firstTouchAttribution();
  assert.equal(JSON.stringify(firstTouch), JSON.stringify({
    entryPage: '/e2b-alternative/',
    campaign: { utm_source: 'google', utm_campaign: 'e2b', gclid: 'Click_123' },
  }));
  assert.ok(!JSON.stringify(f.calls).includes('Click_123'));
  assert.ok(!JSON.stringify(firstTouch).includes('user@example.com'));
});

test('first-touch snapshot falls back to in-memory attribution when the localStorage getter throws', () => {
  const f = fixture({ href: 'https://mainbrella.com/try/?utm_source=google&gclid=click_987' });
  f.trackFunnel('page_view');
  f.blockLocalStorageGetter();
  assert.equal(JSON.stringify(f.firstTouchAttribution()), JSON.stringify({
    entryPage: '/try/', campaign: { utm_source: 'google', gclid: 'click_987' },
  }));
});

test('accepted acquisition pages persist first touch with no GA ID, including after consent acceptance', () => {
  const direct = fixture({ href: 'https://mainbrella.com/try/?utm_source=google&gclid=click_987', pageBehavior: true, measurementId: '' });
  assert.ok(direct.local.has('mainbrella-acquisition'));
  assert.equal(direct.events().length, 0);

  const deferred = fixture({ choice: '', href: 'https://mainbrella.com/try/?utm_campaign=first', pageBehavior: true, measurementId: '' });
  assert.equal(deferred.local.has('mainbrella-acquisition'), false);
  deferred.choice('accepted');
  const saved = JSON.parse(deferred.local.get('mainbrella-acquisition')!);
  assert.equal(saved.entry, '/try/');
  assert.equal(saved.campaign.utm_campaign, 'first');
  assert.equal(deferred.events().length, 0);
});

test('malformed and expired stored campaigns fall back to the current landing page', () => {
  for (const value of ['invalid json', JSON.stringify({ at: 1, entry: '/old/', campaign: { creator: 'expired' } })]) {
    const f = fixture({ local: new Map([['mainbrella-acquisition', value]]) }); f.trackFunnel('page_view');
    assert.equal((f.events()[0][2] as Record<string, unknown>).creator, 'alex');
  }
});

test('blocked attribution storage still sends events and never interrupts product operations', () => {
  const f = fixture({ blocked: true });
  assert.doesNotThrow(() => { f.identifyAccount('user-one'); f.trackFunnel('sign_up'); f.trackMachineStart('small'); f.trackConfirmedPayment('session', 'builder'); });
  assert.equal(f.events().length, 3);
  f.window.gtag = () => { throw new Error('tracking blocked'); };
  assert.doesNotThrow(() => { f.identifyAccount(null); f.trackFunnel('login'); });
});

test('confirmed checkout events deduplicate repeated confirmation without sending Stripe identifiers', () => {
  const f = fixture();
  f.trackConfirmedPayment('private_checkout_session', 'builder'); f.trackConfirmedPayment('private_checkout_session', 'builder');
  assert.equal(f.events().length, 1); assert.equal(f.events()[0][1], 'payment_confirmed');
  assert.ok(!JSON.stringify(f.calls).includes('private_checkout_session'));
});

test('repeat machine use is account-scoped and emits next-day return once per day', () => {
  const f = fixture(); f.identifyAccount('user-one');
  const today = Math.floor(Date.now() / 86_400_000);
  f.local.set('mainbrella-machine-days:user-one', JSON.stringify({ firstDay: today - 1, lastDay: today - 1 }));
  f.trackMachineStart('small'); f.trackMachineStart('small');
  assert.deepEqual(f.events().map(event => event[1]), ['machine_started', 'machine_returned', 'machine_return_next_day', 'machine_started']);
  f.identifyAccount('user-two'); f.trackMachineStart('lite');
  assert.equal(f.events().at(-1)?.[1], 'machine_started');
  assert.equal(f.events().filter(event => event[1] === 'machine_returned').length, 1);
});

test('engagement counts visible time after consent and resumes after a hidden tab', () => {
  const f = fixture({ choice: 'rejected', pageBehavior: true });
  assert.equal(f.timer(), null); assert.equal(f.events().length, 0);
  f.choice('accepted'); assert.equal(f.events()[0][1], 'page_view');
  f.advance(4_000); f.visibility('hidden'); assert.equal(f.timer(), null);
  f.advance(20_000); f.visibility('visible'); assert.equal(f.timer()?.delay, 6_000);
  f.fireTimer(); assert.equal(f.events().at(-1)?.[1], 'landing_engaged');
  f.visibility('hidden'); f.visibility('visible'); assert.equal(f.timer(), null);
});

test('Quickstart reading requires ten visible seconds, and rejecting cancels pending engagement', () => {
  const f = fixture({ pageBehavior: true, href: 'https://mainbrella.com/docs/' });
  assert.deepEqual(f.events().map(event => event[1]), ['page_view', 'quickstart_view']);
  f.advance(2_000); f.choice('rejected'); assert.equal(f.timer(), null);
  assert.equal((f.window as unknown as Record<string, unknown>)['ga-disable-G-TEST123'], true);
  f.choice('accepted'); assert.equal(f.timer()?.delay, 8_000);
  assert.equal((f.window as unknown as Record<string, unknown>)['ga-disable-G-TEST123'], false);
  f.fireTimer(); assert.equal(f.events().at(-1)?.[1], 'quickstart_read');
});
