import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const source = await readFile(new URL('./acquisition-spine.ts', import.meta.url), 'utf8');
type Methods = Pick<typeof import('./acquisition-spine.ts'), 'captureRepository' | 'linkPendingAcquisition' | 'clearAcquisitionTokens'>;
const compiled = transpileModule(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
}).outputText;

function fixture({ choice = 'accepted', blocked = false, failFetch = 0, holdFetch = false, holdLink = false } = {}) {
  let consent = choice;
  const data = new Map<string, string>();
  let storageReads = 0;
  let storageWrites = 0;
  const storage = {
    getItem(key: string) { storageReads++; if (blocked) throw new Error('blocked'); return data.get(key) ?? null; },
    setItem(key: string, value: string) { storageWrites++; if (blocked) throw new Error('blocked'); data.set(key, value); },
    removeItem(key: string) { storageWrites++; if (blocked) throw new Error('blocked'); data.delete(key); },
  };
  const calls: { url: string; options: RequestInit }[] = [];
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>(resolve => { releaseFetch = resolve; });
  const listeners = new Map<string, (event: unknown) => void>();
  let firstTouch: { entryPage: string; campaign: Record<string, string> } | null = {
    entryPage: '/try/',
    campaign: { utm_source: 'newsletter', utm_campaign: 'october_26', creator: 'sam', gclid: 'abc_123', fbclid: 'bad value' },
  };
  const context = {
    readConsent: () => consent,
    firstTouchAttribution: () => firstTouch,
    API_ORIGIN: 'https://api.test',
    normalizeRepo: (value: string) => value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, ''),
    validRepo: (value: string) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value),
    window: { addEventListener(type: string, callback: (event: unknown) => void) { listeners.set(type, callback); } },
    sessionStorage: storage,
    crypto: webcrypto,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Promise,
    fetch: async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      if (holdFetch || holdLink && url.endsWith('/acquisition/link')) await fetchGate;
      if (failFetch > 0) { failFetch--; throw new Error('offline'); }
      return { ok: true };
    },
  };
  const methods = runInNewContext(compiled + '\n({captureRepository,linkPendingAcquisition,clearAcquisitionTokens})', context) as Methods;
  return { ...methods, calls, data, setConsent(value: string) { consent = value; }, storageCounts: () => ({ storageReads, storageWrites }),
    reject() { consent = 'rejected'; listeners.get('cookie-consent-change')?.({ detail: { choice: 'rejected' } }); },
    setFirstTouch(value: typeof firstTouch) { firstTouch = value; }, release() { releaseFetch(); },
    pending() { return JSON.parse(data.get('mainbrella:acquisition-pending') || '{}') as Record<string, Record<string, unknown>>; } };
}

test('unknown and rejected consent do not read or write storage or send requests', async () => {
  for (const choice of ['', 'rejected']) {
    const f = fixture({ choice });
    await f.captureRepository('owner/repo', 'try_v1');
    await f.linkPendingAcquisition('account-1');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.storageCounts(), { storageReads: 0, storageWrites: 0 });
  }
});

test('accepted capture sends only a normalized repository, random token and sanitized first touch', async () => {
  const f = fixture();
  await f.captureRepository('https://github.com/owner/repo.git', 'try_v1');
  const request = f.calls[0];
  assert.equal(request.url, 'https://api.test/acquisition/repositories');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.keepalive, true);
  const body = JSON.parse(String(request.options.body));
  assert.equal(body.repo, 'owner/repo');
  assert.match(body.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(body.attribution, { entryPage: '/try/', variant: 'try_v1', utm_source: 'newsletter', utm_campaign: 'october_26', creator: 'sam', gclid: 'abc_123' });
  assert.equal(JSON.stringify(request.options.body).includes('bad value'), false);
  assert.equal(JSON.stringify(request.options.body).includes('email'), false);
  assert.equal(JSON.stringify(f.calls).includes('lead.captured'), false);
});

test('invalid campaign slugs are omitted and unsafe or oversized entry paths fall back to root', async () => {
  const f = fixture();
  f.setFirstTouch({ entryPage: `//${'a'.repeat(301)}`, campaign: { utm_source: '_hidden', creator: '-bad', utm_campaign: 'valid_slug' } });
  await f.captureRepository('owner/repo', 'try_v1');
  const body = JSON.parse(String(f.calls[0].options.body));
  assert.deepEqual(body.attribution, { entryPage: '/', variant: 'try_v1', utm_campaign: 'valid_slug' });
});

test('capture retry reuses the same token and preserves the original repository attribution and variant', async () => {
  const f = fixture({ failFetch: 1 });
  await f.captureRepository('owner/repo', 'run_v1');
  f.setFirstTouch({ entryPage: '/later/', campaign: { utm_source: 'changed' } });
  await f.captureRepository('owner/repo', 'run_v1');
  await f.captureRepository('OWNER/REPO', 'try_v1');
  const first = JSON.parse(String(f.calls[0].options.body));
  const retry = JSON.parse(String(f.calls[1].options.body));
  assert.equal(first.token, retry.token);
  assert.equal(retry.repo, 'owner/repo');
  assert.deepEqual(retry.attribution, first.attribution);
  assert.equal(retry.attribution.variant, 'run_v1');
  assert.equal(f.calls.length, 2);
});

test('link posts only the pending token and retains the stable linked token for later captures', async () => {
  const f = fixture();
  await f.captureRepository('owner/repo', 'try_v1');
  const token = JSON.parse(String(f.calls[0].options.body)).token;
  await f.linkPendingAcquisition('account-id');
  const link = f.calls[1];
  assert.equal(link.url, 'https://api.test/acquisition/link');
  assert.equal(link.options.credentials, 'include');
  assert.deepEqual(JSON.parse(String(link.options.body)), { token });
  assert.equal(String(link.options.body).includes('account-id'), false);
  assert.equal(f.pending()['owner/repo'].token, token);
  assert.equal(f.pending()['owner/repo'].linkedAccountId, 'account-id');
  f.setFirstTouch({ entryPage: '/later/', campaign: { utm_source: 'later' } });
  await f.captureRepository('OWNER/REPO', 'run_v1');
  await f.linkPendingAcquisition('account-id');
  assert.equal(f.calls.length, 2);
  assert.equal(f.pending()['owner/repo'].token, token);
});

test('link retries capture before linking when the first repository request failed', async () => {
  const f = fixture({ failFetch: 1 });
  await f.captureRepository('owner/repo', 'try_v1');
  await f.linkPendingAcquisition('account-id');
  assert.deepEqual(f.calls.map(call => call.url), [
    'https://api.test/acquisition/repositories',
    'https://api.test/acquisition/repositories',
    'https://api.test/acquisition/link',
  ]);
  assert.equal(f.pending()['owner/repo'].captured, true);
  assert.equal(f.pending()['owner/repo'].linkedAccountId, 'account-id');
});

test('a captured intent created before session lookup is linked when capture runs afterward', async () => {
  const f = fixture();
  await f.linkPendingAcquisition('account-id');
  const token = 'a'.repeat(64);
  f.data.set('mainbrella:acquisition-pending', JSON.stringify({ 'owner/repo': {
    token, createdAt: Date.now(), repo: 'owner/repo', attribution: { entryPage: '/try/', variant: 'try_v1' }, captured: true,
  } }));
  await f.captureRepository('owner/repo', 'run_v1');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.test/acquisition/link');
  assert.deepEqual(JSON.parse(String(f.calls[0].options.body)), { token });
});

test('concurrent capture calls for one repo share one request and one token', async () => {
  const f = fixture({ holdFetch: true });
  const first = f.captureRepository('owner/repo', 'try_v1');
  const second = f.captureRepository('OWNER/REPO', 'run_v1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.release();
  await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  assert.equal((f.pending()['owner/repo'].attribution as Record<string, unknown>).variant, 'try_v1');
});

test('stored intents are validated, canonicalized and limited to the newest twenty', async () => {
  const f = fixture();
  const now = Date.now();
  const records: Record<string, unknown> = {};
  for (let i = 0; i < 25; i++) {
    const repo = `owner/repo-${i}`;
    records[repo] = { token: i.toString(16).padStart(64, '0'), createdAt: now - (25 - i), repo,
      attribution: { entryPage: '/try/', variant: 'try_v1' }, captured: true };
  }
  records['owner/expired'] = { token: 'f'.repeat(64), createdAt: now - 31 * 86_400_000, repo: 'owner/expired', attribution: { entryPage: '/try/', variant: 'try_v1' }, captured: true };
  records['owner/future'] = { token: 'e'.repeat(64), createdAt: now + 10_000, repo: 'owner/future', attribution: { entryPage: '/try/', variant: 'try_v1' }, captured: true };
  f.data.set('mainbrella:acquisition-pending', JSON.stringify(records));
  await f.captureRepository('OWNER/NewRepo', 'run_v1');
  const saved = f.pending();
  assert.equal(Object.keys(saved).length, 20);
  assert.ok(saved['owner/newrepo']);
  assert.ok(!saved['owner/expired']);
  assert.ok(!saved['owner/future']);
});

test('logout during a request prevents the late response from restoring cleared intents', async () => {
  const f = fixture({ holdFetch: true });
  const capture = f.captureRepository('owner/repo', 'try_v1');
  await new Promise(resolve => setImmediate(resolve));
  f.clearAcquisitionTokens();
  f.release();
  await capture;
  assert.deepEqual(JSON.parse(f.data.get('mainbrella:acquisition-pending') || '{}'), {});
  assert.deepEqual(f.pending(), {});
});

test('account switch during a pending link prevents the old account response from restoring its token', async () => {
  const f = fixture({ holdLink: true });
  await f.captureRepository('owner/repo', 'try_v1');
  const oldAccountLink = f.linkPendingAcquisition('account-old');
  await new Promise(resolve => setImmediate(resolve));
  await f.linkPendingAcquisition('account-new');
  f.release();
  await oldAccountLink;
  assert.deepEqual(JSON.parse(f.data.get('mainbrella:acquisition-pending') || '{}'), {});
  assert.equal(f.data.get('mainbrella:acquisition-account'), 'account-new');
});

test('blocked storage uses memory, failures stay best effort, and rejection or account switch clears pending tokens', async () => {
  const f = fixture({ blocked: true, failFetch: 1 });
  await assert.doesNotReject(f.captureRepository('owner/repo', 'try_v1'));
  await assert.doesNotReject(f.captureRepository('owner/repo', 'try_v1'));
  assert.equal(JSON.parse(String(f.calls[1].options.body)).token, JSON.parse(String(f.calls[0].options.body)).token);
  await f.linkPendingAcquisition('account-a');
  await f.captureRepository('owner/second', 'run_v1');
  await f.linkPendingAcquisition('account-b');
  const beforeReject = f.calls.length;
  f.reject();
  await f.captureRepository('owner/third', 'run_v1');
  assert.equal(f.calls.length, beforeReject);
  assert.doesNotThrow(() => f.clearAcquisitionTokens());
});
