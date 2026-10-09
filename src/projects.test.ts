import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
class Element {
  [key: string]: any;
  hidden = true;
  disabled = false;
  textContent = '';
  value = '';
  children: Element[] = [];
  listeners = new Map<string, (event: any) => unknown>();
  attributes = new Map<string, string>();
  classList = { add() {}, remove() {} };
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  reportValidity() { return true; }
  focus() { if (!this.disabled) this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire('close'); }
  async fire(type: string, event: any = { preventDefault() {} }) { return this.listeners.get(type)?.(event); }
}

const originalProject = { id: 'project-1', name: 'First project', domain: 'example.com', created_at: '2026-01-01T00:00:00Z' };
const secondProject = { id: 'project-2', name: 'Second project', created_at: '2026-01-02T00:00:00Z' };

async function fixture(t: TestContext, respond: (url: string, options: RequestInit) => Promise<Response> | Response = defaultResponse) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const name = node('#project-name');
  const domain = node('#project-domain');
  node('#project-form').reset = () => { name.value = ''; domain.value = ''; };
  const calls: { url: string; options: RequestInit }[] = [];
  const redirects: string[] = [];
  const window = {
    localStorage: { getItem: () => 'accepted', setItem() {} },
    sessionStorage: { getItem: () => 'accepted', setItem() {} },
    location: { hostname: 'localhost', pathname: '/projects/', search: '', hash: '', replace: (url: string) => redirects.push(url) },
    addEventListener() {}, dispatchEvent() {},
  };
  const property = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  property('window', window);
  property('location', window.location);
  property('document', { querySelector: node, createElement: () => new Element() });
  property('fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return respond(url, options);
  });
  await import(`./projects.ts?test=${++sequence}`);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { node: (selector: string) => node(selector), calls, redirects };
}

function defaultResponse(url: string, options: RequestInit) {
  if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
  if (options.method === 'GET') return Response.json({ projects: [originalProject, secondProject] });
  if (options.method === 'PATCH') {
    const requested = JSON.parse(String(options.body));
    return Response.json({ project: { ...originalProject, name: requested.name, domain: requested.domain } });
  }
  return Response.json({ project: { id: 'project-3', ...JSON.parse(String(options.body)), created_at: '2026-01-03T00:00:00Z' } }, { status: 201 });
}

function editButton(f: Awaited<ReturnType<typeof fixture>>, index: number) {
  return f.node('#project-list').children[index].children[2].children[0].children[0];
}

test('shared dialog creates and edits projects, preserves order, and resets its mode', async t => {
  const f = await fixture(t);
  const dialog = f.node('#project-dialog');
  const title = f.node('#project-dialog-title');
  const form = f.node('#project-form');
  const name = f.node('#project-name');
  const domain = f.node('#project-domain');

  await editButton(f, 0).fire('click');
  assert.equal(name.value, 'First project');
  assert.equal(domain.value, 'example.com');
  assert.equal(title.textContent, 'Edit project');
  assert.equal(f.node('#project-create').textContent, 'Save changes');
  await f.node('#project-cancel').fire('click');
  assert.equal(dialog.open, false);
  assert.equal(title.textContent, 'New project');

  await f.node('#project-new').fire('click');
  assert.equal(name.value, '');
  assert.equal(domain.value, '');
  name.value = 'Third project';
  domain.value = '  third.example  ';
  await form.fire('submit');
  const createdCall = f.calls.find(call => call.options.method === 'POST')!;
  assert.deepEqual(JSON.parse(String(createdCall.options.body)), { name: 'Third project', domain: 'third.example' });
  assert.equal(f.node('#project-list').children[0].children[0].textContent, 'Third project');
  assert.equal(f.node('#project-list').children[0].children[1].textContent, 'third.example');
  assert.equal(editButton(f, 0).focused, true);

  await editButton(f, 1).fire('click');
  assert.equal(name.value, 'First project');
  assert.equal(domain.value, 'example.com');
  name.value = 'Renamed project';
  domain.value = '';
  await form.fire('submit');
  const updatedCall = f.calls.find(call => call.options.method === 'PATCH')!;
  assert.match(updatedCall.url, /\/projects\?id=project-1$/);
  assert.equal(updatedCall.options.credentials, 'include');
  assert.equal(updatedCall.options.redirect, 'error');
  assert.deepEqual(JSON.parse(String(updatedCall.options.body)), { name: 'Renamed project', domain: null });
  const rows = f.node('#project-list').children;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].children[0].textContent, 'Renamed project');
  assert.equal(rows[1].children[1].textContent, '—');
  assert.equal(rows[2].children[0].textContent, 'Second project');
  assert.equal(editButton(f, 1).focused, true);
  assert.equal(title.textContent, 'New project');
  assert.equal(name.value, '');
  assert.equal(domain.value, '');
});

test('failed edit keeps the draft, locks controls while pending, and can be retried', async t => {
  let finish!: (response: Response) => void;
  let failNext = true;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (options.method === 'GET') return Response.json({ projects: [originalProject] });
    if (failNext) return new Promise<Response>(resolve => { finish = resolve; });
    const requested = JSON.parse(String(options.body));
    return Response.json({ project: { ...originalProject, name: requested.name, domain: requested.domain } });
  });
  const name = f.node('#project-name');
  const domain = f.node('#project-domain');
  await editButton(f, 0).fire('click');
  name.value = 'Draft name';
  domain.value = 'draft.example';
  const submitted = f.node('#project-form').fire('submit');
  assert.equal(f.node('#project-create').disabled, true);
  assert.equal(domain.disabled, true);
  assert.equal(editButton(f, 0).disabled, true);
  let prevented = false;
  await f.node('#project-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  failNext = false;
  finish(Response.json({ error: 'unavailable' }, { status: 503 }));
  await submitted;
  assert.equal(f.node('#project-error').hidden, false);
  assert.match(f.node('#project-error').textContent, /Could not save/);
  assert.equal(name.value, 'Draft name');
  assert.equal(domain.value, 'draft.example');
  assert.equal(f.node('#project-create').disabled, false);
  assert.equal(domain.disabled, false);
  await f.node('#project-form').fire('submit');
  assert.equal(f.node('#project-list').children.length, 1);
  assert.equal(f.node('#project-list').children[0].children[0].textContent, 'Draft name');
  assert.equal(f.node('#project-list').children[0].children[1].textContent, 'draft.example');
});

test('a 401 during edit disposes the page and redirects to login', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (options.method === 'GET') return Response.json({ projects: [originalProject] });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  });
  const staleEdit = editButton(f, 0);
  await staleEdit.fire('click');
  f.node('#project-name').value = 'Private draft';
  await f.node('#project-form').fire('submit');
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fprojects%2F']);
  assert.equal(f.node('#project-list').children.length, 0);
  assert.equal(f.node('#project-new').disabled, true);
  await staleEdit.fire('click');
  assert.equal(f.node('#project-dialog').open, false);
});
