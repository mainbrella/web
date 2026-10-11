import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;

async function fixture(t: TestContext, search: string, response: () => Promise<Response>) {
  const attributes = new Map<string, string>();
  const status = { textContent: '' };
  let retryClick!: () => Promise<void>;
  const retry = { hidden: true, addEventListener(_event: string, callback: () => Promise<void>) { retryClick = callback; } };
  const nodes: Record<string, unknown> = {
    '#main': { setAttribute(name: string, value: string) { attributes.set(name, value); } },
    '#unsubscribe-status': status,
    '#unsubscribe-retry': retry,
  };
  const calls: { url: string; options?: RequestInit }[] = [];
  for (const [name, value] of Object.entries({
    location: { hostname: 'mainbrella.com', search },
    document: { querySelector(selector: string) { return nodes[selector]; } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return response();
  });
  await import(`./unsubscribe.ts?test=${++sequence}`);
  await new Promise(resolve => setImmediate(resolve));
  return { status, retry, attributes, calls, clickRetry: () => retryClick() };
}

test('one click automatically unsubscribes the encoded address without credentials or login', async t => {
  const email = 'Member+news@example.com';
  const f = await fixture(t, `?email=${encodeURIComponent(email)}`, async () => Response.json({ ok: true }));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.mainbrella.com/api/unsubscribe');
  assert.equal(f.calls[0].options?.method, 'POST');
  assert.equal(f.calls[0].options?.credentials, 'omit');
  assert.deepEqual(JSON.parse(f.calls[0].options?.body as string), { email });
  assert.match(f.status.textContent, /^You have been unsubscribed\./);
  assert.equal(f.retry.hidden, true);
  assert.equal(f.attributes.get('aria-busy'), 'false');
});

test('missing or invalid addresses show useful feedback without confirming an opt-out', async t => {
  const missing = await fixture(t, '', async () => { throw new Error('unexpected request'); });
  assert.equal(missing.calls.length, 0);
  assert.match(missing.status.textContent, /missing an email address/);
  assert.equal(missing.retry.hidden, true);
  const invalid = await fixture(t, '?email=invalid', async () => Response.json({ error: 'invalid_request' }, { status: 400 }));
  assert.match(invalid.status.textContent, /link is invalid/);
  assert.equal(invalid.retry.hidden, true);
});

test('network and saving failures show a retry and confirmation waits for success', async t => {
  let attempts = 0;
  const f = await fixture(t, '?email=member%40example.com', async () => {
    if (++attempts === 1) throw new Error('network unavailable');
    if (attempts === 2) return Response.json({ error: 'email_preferences_unavailable' }, { status: 503 });
    return Response.json({ ok: true });
  });
  assert.match(f.status.textContent, /couldn’t unsubscribe/);
  assert.equal(f.retry.hidden, false);
  await f.clickRetry();
  assert.match(f.status.textContent, /couldn’t unsubscribe/);
  assert.equal(f.retry.hidden, false);
  await f.clickRetry();
  assert.match(f.status.textContent, /^You have been unsubscribed\./);
  assert.equal(f.retry.hidden, true);
  assert.equal(f.calls.length, 3);
});
