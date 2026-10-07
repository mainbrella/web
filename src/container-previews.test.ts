import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location ??= { hostname: 'localhost' } as Location;
const { previewMetadata, validPreviewPort, createPreviewClient, createContainerPreviews } = await import('./container-previews.ts');
const container = { id: 'small', createdAt: '2026-10-05T12:00:00.000Z' };
const grant = { id: 'b'.repeat(32), port: 3000, createdAt: container.createdAt, expiresAt: Date.now() + 900_000 };
const link = { ...grant, url: `https://${'a'.repeat(48)}.preview.example/` };

test('preview responses exclude private fields and reject unsafe URLs or replacement generations', () => {
  assert.deepEqual(previewMetadata({ ...grant, token: 'secret', tokenHash: 'hash' }, container.createdAt), grant);
  assert.deepEqual(previewMetadata(link, container.createdAt, true), link);
  for (const url of ['javascript:alert(1)', 'http://localhost/', 'https://mainbrella.com/',
    `https://${'a'.repeat(48)}.mainbrella.com/`, `https://${'a'.repeat(48)}.sub.mainbrella.com/`,
    `https://user:secret@${'a'.repeat(48)}.preview.example/`, `${link.url}?secret=token`, `${link.url}path`]) {
    assert.throws(() => previewMetadata({ ...link, url }, container.createdAt, true));
  }
  assert.throws(() => previewMetadata(grant, '2026-10-05T12:01:00.000Z'));
  for (const port of [22, 1023, 65536, 3000.5, '3000']) assert.equal(validPreviewPort(port), false);
});

test('preview browser requests retain exact identity and one-time issuance without retries', async () => {
  const calls = [];
  const request = createPreviewClient({ fetcher: async (url, options) => {
    calls.push(options);
    assert.equal((url as URL).searchParams.get('id'), container.id);
    assert.equal((url as URL).searchParams.get('createdAt'), container.createdAt);
    assert.equal(options!.credentials, 'include');
    assert.equal(options!.redirect, 'error');
    if (options!.method === 'POST') {
      assert.deepEqual(JSON.parse(options!.body as string), { port: 3000 });
      return Response.json(link, { status: 201 });
    }
    if (options!.method === 'DELETE') {
      assert.equal((url as URL).searchParams.get('previewId'), grant.id);
      return Response.json({ revoked: true });
    }
    return Response.json({ previews: [grant] });
  } });
  assert.deepEqual(await request(container), [grant]);
  assert.deepEqual(await request(container, 'POST', 3000), link);
  assert.deepEqual(await request(container, 'DELETE', grant.id), { revoked: true });
  assert.equal(calls.length, 3);
});

test('local preview links use isolated localhost hosts on the local API port', () => {
  const local = { ...grant, url: `http://${'a'.repeat(48)}.localhost:8787/` };
  assert.deepEqual(previewMetadata(local, container.createdAt, true), local);
  for (const url of [local.url.replace(':8787', ':9999'), local.url.replace('.localhost', '.example.com'),
    local.url.replace('http:', 'https:'), `${local.url}?token=secret`]) {
    assert.throws(() => previewMetadata({ ...local, url }, container.createdAt, true));
  }
});

test('preview errors support safe cleanup and never render server text or retry issuance', async () => {
  let calls = 0, signedOut = false;
  const request = createPreviewClient({ fetcher: async () => { calls++; throw new Error('secret'); } });
  await assert.rejects(request(container, 'POST', 3000));
  assert.equal(calls, 1);
  const reconciliation = createPreviewClient({ fetcher: async () => Response.json({
    error: 'preview_reconciliation_required', previewId: grant.id, token: 'secret',
  }, { status: 503 }) });
  await assert.rejects(reconciliation(container, 'DELETE', grant.id), cause => (cause as Error & { previewId?: string }).previewId === grant.id && !JSON.stringify(cause).includes('secret'));
  const invalid = createPreviewClient({ onUnauthenticated: () => { signedOut = true; },
    fetcher: async () => Response.json({ error: '<script>secret</script>', previewId: 'secret' }, { status: 401 }) });
  await assert.rejects(invalid(container), { message: 'previews_unavailable' });
  assert.equal(signedOut, true);
});

// Replace browser boundaries only; run the actual preview controller and requests.
// These partial DOM doubles expose only the browser properties exercised here.
class Element {
  [key: string]: any;
  children: Element[] = [];
  parent: Element | null = null;
  attributes: Record<string, string> = {};
  constructor(tag: string) { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; }
  get lastElementChild(): Element | null { return this.children.at(-1) ?? null; }
  get valueAsNumber() { return Number(this.value); }
  append(...nodes: Element[]) { for (const node of nodes) { node.remove?.(); node.parent = this; this.children.push(node); } }
  insertBefore(node: Element, target: Element) { node.remove(); node.parent = this; const index = this.children.indexOf(target); this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  replaceChildren(...nodes: Element[]) { for (const node of [...this.children]) node.remove?.(); this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  querySelectorAll(tag: string): Element[] { return this.children.flatMap(node => [...(node.tag === tag ? [node] : []), ...(node.querySelectorAll?.(tag) ?? [])]); }
  reportValidity() { return true; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t: TestContext, fetcher: (url: URL, options: RequestInit) => Promise<Response>) {
  t.mock.method(globalThis, 'fetch', fetcher);
  let tick!: () => void;
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => ({ textContent: text }),
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, "document"); });
  const controller = createContainerPreviews({ onUnauthenticated() {} });
  t.after(() => controller.dispose());
  const running = { ...container, status: 'running', expiresAt: Date.now() + 900_000 };
  const row = new Element('li'), actions = new Element('div');
  row.append(actions);
  const attach = (enabled: boolean, identity = running) => { controller.sync([identity], enabled); controller.attach(row as unknown as HTMLElement, actions as unknown as HTMLElement, identity); };
  const button = (name: string) => row.querySelectorAll('button').find(node => node.textContent === name);
  const submit = async () => { row.querySelectorAll('form')[0].onsubmit({ preventDefault() {} }); await settle(); };
  const click = async (name: string) => { assert.equal(button(name)!.disabled, false, `${name} is enabled`); button(name)!.onclick(); await settle(); };
  return { controller, row, actions, attach, button, click, submit, tick: () => tick() };
}

test('preview controls are capability gated and preserve inputs and one-time links through polling until expiry', async t => {
  const f = fixture(t, async (url, options) => options!.method === 'POST' ? Response.json(link, { status: 201 }) : Response.json({ previews: [] }));
  f.attach(false);
  assert.equal(f.button('Preview'), undefined);
  f.attach(true);
  await f.click('Preview');
  const input = f.row.querySelectorAll('input')[0];
  input.value = '3001';
  await f.submit();
  assert.equal(f.row.querySelectorAll('a')[0].href, link.url);
  f.attach(true);
  assert.equal(f.row.querySelectorAll('input')[0], input);
  assert.equal(input.value, '3001');
  assert.equal(f.row.querySelectorAll('a')[0].href, link.url);
  t.mock.method(Date, 'now', () => link.expiresAt + 1);
  f.tick();
  assert.equal(f.row.querySelectorAll('a').length, 0);
});

test('lost issuance disables creation until metadata reconciliation and does not recover URLs', async t => {
  let grants: typeof grant[] = [], posts = 0;
  const f = fixture(t, async (url, options) => {
    if (options!.method === 'POST') { posts++; grants = [grant]; throw new Error('response lost'); }
    if (options!.method === 'DELETE') { grants = []; return Response.json({ revoked: true }); }
    return Response.json({ previews: grants });
  });
  f.attach(true); await f.click('Preview'); await f.submit();
  assert.equal(posts, 1);
  assert.equal(f.button('Create link')!.disabled, true);
  await f.click('Refresh previews');
  assert.equal(f.row.querySelectorAll('a').length, 0);
  await f.click('Revoke');
  assert.equal(f.button('Create link')!.disabled, false);
});

test('reconciliation IDs remain revocable while new issuance is disabled', async t => {
  let failed = true, deletes = 0;
  const f = fixture(t, async (url, options) => {
    if (options!.method === 'POST' || options!.method === 'DELETE' && failed) return Response.json({
      error: 'preview_reconciliation_required', previewId: grant.id,
    }, { status: 503 });
    if (options!.method === 'DELETE') { deletes++; assert.equal((url as URL).searchParams.get('previewId'), grant.id); return Response.json({ revoked: true }); }
    return Response.json({ previews: [] });
  });
  f.attach(true); await f.click('Preview'); await f.submit();
  assert.equal(f.button('Create link')!.disabled, true);
  f.attach(false);
  await f.click('Revoke');
  assert.equal(f.button('Create link')!.disabled, true);
  failed = false; await f.click('Revoke');
  assert.equal(deletes, 1);
  assert.equal(f.button('Revoke'), undefined);
});

test('a late issuance response cannot restore links for a replaced generation', async t => {
  let resolve!: (response: Response) => void;
  const f = fixture(t, async (url, options) => options!.method === 'POST'
    ? new Promise<Response>(done => { resolve = done; }) : Response.json({ previews: [] }));
  f.attach(true); await f.click('Preview'); await f.submit();
  f.attach(true, { expiresAt: Date.now() + 900_000, ...container, status: 'running', createdAt: '2026-10-05T12:01:00.000Z' });
  resolve(Response.json(link, { status: 201 })); await settle();
  assert.equal(f.row.querySelectorAll('a').length, 0);
  assert.equal(f.row.querySelectorAll('input').length, 1);
  assert.equal(f.button('Preview')!.attributes['aria-expanded'], 'false');
});
