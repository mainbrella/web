import test from 'node:test';
import assert from 'node:assert/strict';
Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { createProjectHostingClient, parseEndpointData, copyDnsValue, createProjectHosting, safeEndpointUrl, safeCustomDomainUrl } = await import('./project-hosting.ts');
const { generationKey } = await import('./private-services.ts');

const domain = { id: 'domain-1', hostname: 'app.example.com', status: 'pending_dns', dnsStatus: 'pending', tlsStatus: 'pending', dnsRecords: [
  { type: 'TXT', name: '_verify.app.example.com', value: 'token', purpose: 'ownership' },
], error: null };
const endpoint = { endpoint: { projectId: 'project-1', url: 'https://abc.mainbrella.app', target: null, backendStatus: 'unlinked' }, domains: [domain], hosting: { supported: true, customDomains: true, apexIps: ['192.0.2.1'] } };

test('endpoint response validates target union and retains DNS status and records', () => {
  const result = parseEndpointData(endpoint);
  assert.equal(result.domains[0].status, 'pending_dns');
  assert.deepEqual(result.domains[0].dnsRecords[0], domain.dnsRecords[0]);
  assert.throws(() => parseEndpointData({ ...endpoint, endpoint: { ...endpoint.endpoint, target: { kind: 'container', id: 'c1', createdAt: '2026-02-30T00:00:00Z', port: 3000 } } }), /invalid_response/);
  assert.throws(() => parseEndpointData({ ...endpoint, endpoint: { ...endpoint.endpoint, target: { kind: 'network', network: 'valid-net', id: 'c1' } } }), /invalid_response/);
  assert.throws(() => parseEndpointData({ ...endpoint, endpoint: { ...endpoint.endpoint, target: { kind: 'container', id: 'c1', createdAt: '2026-01-01T00:00:00.000Z', port: 1023 } } }), /invalid_response/);
  assert.throws(() => parseEndpointData({ ...endpoint, hosting: { ...endpoint.hosting, localDevelopment: 'true' } }), /invalid_response/);
  assert.equal(parseEndpointData({ ...endpoint, hosting: { ...endpoint.hosting, localDevelopment: true } }).hosting.localDevelopment, true);
});

test('endpoint and custom domain links enforce their HTTPS hostname contracts', () => {
  assert.equal(safeEndpointUrl(`https://p-${'a'.repeat(32)}.mainbrella.dev/`)?.protocol, 'https:');
  assert.equal(safeEndpointUrl('https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mainbrella.com/'), null);
  assert.equal(safeEndpointUrl('javascript:alert(1)'), null);
  assert.equal(safeEndpointUrl(`http://p-${'b'.repeat(32)}.localhost:8787/`)?.protocol, 'http:');
  assert.equal(safeEndpointUrl(`http://p-${'b'.repeat(32)}.localhost:9999/`), null);
  assert.equal(safeEndpointUrl(`http://${'b'.repeat(48)}.localhost:8787/`), null);
  assert.equal(safeCustomDomainUrl('shop.xn--p1ai')?.href, 'https://shop.xn--p1ai/');
  assert.equal(safeCustomDomainUrl('www.example.com')?.href, 'https://www.example.com/');
  assert.equal(safeCustomDomainUrl('example.com/path'), null);
  assert.equal(safeCustomDomainUrl('app.localhost', true)?.href, 'http://app.localhost:8787/');
  assert.equal(safeCustomDomainUrl('app.localhost', true)?.protocol, 'http:');
  for (const hostname of ['p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost', `${'a'.repeat(48)}.localhost`, 'app.dev.localhost', 'App.localhost', 'app.example.com', 'foo_bar.localhost']) {
    assert.equal(safeCustomDomainUrl(hostname, true), null, hostname);
  }
});

test('publishing sends the exact selected container generation and preserves a failed draft', async () => {
  const calls: { url: URL; options: RequestInit }[] = [];
  const client = createProjectHostingClient({ fetcher: async (input, options) => {
    calls.push({ url: new URL(String(input)), options: options ?? {} });
    return Response.json({ error: 'container_not_running' }, { status: 409 });
  } });
  const target = { kind: 'container' as const, id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 8080 };
  await assert.rejects(client.save('project-1', { ...target, port: 8080 }), /container_not_running/);
  assert.equal(calls[0].url.pathname, '/projects/endpoint');
  assert.equal(calls[0].url.searchParams.get('id'), 'project-1');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), { target: { ...target, port: 8080 } });
  assert.notEqual(generationKey(target), generationKey({ ...target, createdAt: '2026-01-02T00:00:00.000Z' }));
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.redirect, 'error');
});

test('DNS copy reports success and failure for inline feedback', async () => {
  assert.equal(await copyDnsValue('198.51.100.10', async () => {}), true);
  assert.equal(await copyDnsValue('token', async () => { throw new Error('clipboard unavailable'); }), false);
});

test('401 invokes the unauthenticated handler and does not expose response detail', async () => {
  let redirected = 0;
  const client = createProjectHostingClient({ onUnauthenticated: () => redirected++, fetcher: async () => Response.json({ error: 'unauthorized' }, { status: 401 }) });
  await assert.rejects(client.endpoint('project-1'), /not_authenticated/);
  assert.equal(redirected, 1);
});

test('domain refresh and remove use scoped IDs and preserve server domain state', async () => {
  const calls: { url: URL; options: RequestInit }[] = [];
  const client = createProjectHostingClient({ fetcher: async (input, options) => {
    const url = new URL(String(input)); calls.push({ url, options: options ?? {} });
    if (url.pathname.endsWith('/verify')) return Response.json({ domain: { ...domain, status: 'active', dnsStatus: 'verified', tlsStatus: 'active' }, domains: [], hosting: endpoint.hosting });
    return Response.json({ domains: [], hosting: endpoint.hosting });
  } });
  const verified = await client.verifyDomain('project-1', 'domain-1');
  assert.equal(verified.status, 'active');
  assert.equal(verified.dnsStatus, 'verified');
  await client.removeDomain('project-1', 'domain-1');
  assert.equal(calls[0].url.pathname, '/projects/domains/verify');
  assert.equal(calls[0].url.searchParams.get('domainId'), 'domain-1');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].url.searchParams.get('id'), 'project-1');
  assert.equal(calls[1].url.searchParams.get('domainId'), 'domain-1');
  assert.equal(calls[1].options.method, 'DELETE');
});

test('domain create and endpoint unpublish consume their documented response envelopes', async () => {
  const calls: { url: URL; options: RequestInit }[] = [];
  const client = createProjectHostingClient({ fetcher: async (input, options) => {
    const url = new URL(String(input)); calls.push({ url, options: options ?? {} });
    if (url.pathname === '/projects/domains') return Response.json({ domain, domains: [domain], hosting: endpoint.hosting });
    return Response.json(endpoint);
  } });
  assert.equal((await client.addDomain('project-1', domain.hostname)).id, domain.id);
  assert.equal((await client.unpublish('project-1')).endpoint.target, null);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), { hostname: domain.hostname });
  assert.equal(calls[1].options.method, 'DELETE');
});

class FakeElement {
  [key: string]: any;
  hidden = true; disabled = false; textContent = ''; value = ''; href = ''; children: FakeElement[] = [];
  listeners = new Map<string, (event: any) => unknown>(); attributes = new Map<string, string>(); dataset: Record<string, string> = {};
  classList = { add() {}, remove() {} };
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: FakeElement[]) { this.children.push(...children); }
  replaceChildren(...children: FakeElement[]) { this.children = children; }
  querySelectorAll(selector: string) { return selector === '[data-endpoint-action]' ? this.children.filter(child => child.dataset.endpointAction) : this.children.filter(child => child.value === 'network'); }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire('close'); }
  async fire(type: string, event: any = { preventDefault() {} }) { return this.listeners.get(type)?.(event); }
}

test('controller ignores a save response after the dialog closes and another project opens', async t => {
  const nodes = new Map<string, FakeElement>(); const made: FakeElement[] = [];
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new FakeElement()); return nodes.get(selector)!; };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { querySelector: node, createElement: () => { const item = new FakeElement(); made.push(item); return item; } }, configurable: true });
  let resolveSave!: (response: Response) => void;
  let saveSignal: AbortSignal | undefined;
  const fetcher = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/projects/endpoint' && options.method === 'PUT') { saveSignal = options.signal as AbortSignal; return await new Promise<Response>(resolve => { resolveSave = resolve; }); }
    if (url.pathname === '/projects/endpoint') {
      const id = url.searchParams.get('id');
      return Response.json({ ...endpoint, endpoint: { ...endpoint.endpoint, projectId: id!, url: `https://p-${id === 'project-1' ? '1' : '2'.repeat(32)}.mainbrella.dev/`, backendStatus: 'unlinked' } });
    }
    if (url.pathname === '/capabilities') return Response.json({ networking: { privateServices: false } });
    if (url.pathname === '/containers') return Response.json({ containers: [{ id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', status: 'running', expiresAt: 0 }] });
    throw new Error(`unexpected request ${url.pathname}`);
  };
  const controller = createProjectHosting({ onUnauthenticated() {}, fetcher });
  t.after(() => controller.dispose());
  t.after(() => { if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document'); });
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  controller.open({ id: 'project-1', name: 'First' }); await flush();
  node('#endpoint-mode').value = 'container'; node('#endpoint-container').value = JSON.stringify(['container-1', '2026-01-01T00:00:00.000Z']); node('#endpoint-port').value = '3000';
  const saving = node('#endpoint-save').fire('click'); await flush();
  node('#endpoint-dialog').close();
  assert.equal(saveSignal?.aborted, true);
  controller.open({ id: 'project-2', name: 'Second' }); await flush();
  resolveSave(Response.json({ ...endpoint, endpoint: { ...endpoint.endpoint, projectId: 'project-1', url: 'https://stale.mainbrella.app', target: { kind: 'container', id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 3000 }, backendStatus: 'running' } }));
  await saving; await flush();
  assert.equal(node('#endpoint-title').textContent, 'Endpoint · Second');
  assert.equal(node('#endpoint-url').href, `https://p-${'2'.repeat(32)}.mainbrella.dev/`);
});

test('controller keeps registered domains removable after catalog failure and never displays raw domain errors', async t => {
  const nodes = new Map<string, FakeElement>(); const made: FakeElement[] = [];
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new FakeElement()); return nodes.get(selector)!; };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', { value: { querySelector: node, createElement: () => { const item = new FakeElement(); made.push(item); return item; } }, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: { confirm: () => true }, configurable: true });
  let removed = false;
  const fetcher = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/projects/endpoint') return Response.json({ ...endpoint, hosting: { ...endpoint.hosting, customDomains: false }, domains: [{ ...domain, error: 'dns_internal_error' }] });
    if (url.pathname === '/capabilities') return Response.json({ networking: { privateServices: false } });
    if (url.pathname === '/containers') throw new Error('container catalog unavailable');
    if (url.pathname === '/projects/domains' && options.method === 'DELETE') { removed = true; return Response.json({ domains: [], hosting: endpoint.hosting }); }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  const controller = createProjectHosting({ onUnauthenticated() {}, fetcher });
  node('#endpoint-dialog').querySelectorAll = (selector: string) => selector === '[data-endpoint-action]' ? made.filter(item => item.dataset.endpointAction) : [];
  t.after(() => controller.dispose());
  const oldDocumentAfterController = oldDocument;
  t.after(() => { if (oldDocumentAfterController) Object.defineProperty(globalThis, 'document', oldDocumentAfterController); else Reflect.deleteProperty(globalThis, 'document'); if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  controller.open({ id: 'project-1', name: 'First' }); await flush();
  const list = node('#endpoint-domain-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[3].textContent, 'Verify DNS');
  assert.equal(node('#endpoint-error').textContent.includes('dns_internal_error'), false);
  await list.children[0].children[4].fire('click'); await flush();
  assert.equal(removed, true);
  assert.equal(list.children.length, 0);
  assert.match(node('#endpoint-error').textContent, /target options could not be refreshed/);
});

test('local development activates aliases after two checks and links active aliases to the app', async t => {
  const nodes = new Map<string, FakeElement>(); const made: FakeElement[] = [];
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new FakeElement()); return nodes.get(selector)!; };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { querySelector: node, createElement: (tagName: string) => { const item = new FakeElement(); item.tagName = tagName.toUpperCase(); made.push(item); return item; } }, configurable: true });
  let currentDomain = { ...domain, hostname: 'app.localhost', status: 'pending_tls', dnsStatus: 'verified', tlsStatus: 'pending' };
  let verifications = 0;
  const fetcher = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/projects/endpoint') return Response.json({ ...endpoint, endpoint: { ...endpoint.endpoint, url: `http://p-${'a'.repeat(32)}.localhost:8787/`, target: { kind: 'container', id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 3000 }, backendStatus: 'running' }, domains: [currentDomain], hosting: { ...endpoint.hosting, localDevelopment: true } });
    if (url.pathname === '/capabilities') return Response.json({ networking: { privateServices: false } });
    if (url.pathname === '/containers') return Response.json({ containers: [{ id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', status: 'running', expiresAt: 0 }] });
    if (url.pathname === '/projects/domains/verify') {
      verifications++;
      if (verifications === 2) currentDomain = { ...currentDomain, status: 'active', tlsStatus: 'active' };
      return Response.json({ domain: currentDomain });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  const controller = createProjectHosting({ onUnauthenticated() {}, fetcher });
  node('#endpoint-dialog').querySelectorAll = (selector: string) => selector === '[data-endpoint-action]' ? made.filter(item => item.dataset.endpointAction) : [];
  t.after(() => controller.dispose());
  t.after(() => { if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document'); });
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  controller.open({ id: 'project-1', name: 'Local' }); await flush();
  assert.equal(node('#endpoint-url').href, `http://p-${'a'.repeat(32)}.localhost:8787/`);
  assert.equal(node('#endpoint-hostname').placeholder, 'app.localhost');
  assert.match(node('#endpoint-local-note').textContent, /DNS and TLS are simulated locally/);
  const list = node('#endpoint-domain-list');
  assert.equal(list.children[0].children[0].href, '');
  assert.equal(list.children[0].children[2].textContent, 'Activate locally');
  await list.children[0].children[2].fire('click'); await flush();
  assert.equal(list.children[0].children[2].textContent, 'Activate locally');
  await list.children[0].children[2].fire('click'); await flush();
  assert.equal(list.children[0].children[0].href, 'http://app.localhost:8787/');
  assert.equal(list.children[0].children[1].textContent, 'Active');
});
