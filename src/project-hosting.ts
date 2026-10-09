import { API_ORIGIN } from './auth.ts';
import { generationKey, privateNetworks, type PrivateNetwork } from './private-services.ts';
import type { Container } from './types.ts';

export type EndpointTarget =
  | { kind: 'container'; id: string; createdAt: string; port: number }
  | { kind: 'network'; network: string; service: string };
export interface ProjectDomain {
  id: string; hostname: string; status: 'pending_dns' | 'pending_tls' | 'active' | 'error';
  dnsStatus: 'pending' | 'verified'; tlsStatus: 'pending' | 'active' | 'error';
  dnsRecords: { type: string; name: string; value: string; purpose: 'ownership' | 'routing' | 'certificate' }[];
  error: string | null; apexRecords?: { type: string; name: string; value: string; purpose?: string }[]; routingNote?: string;
}
export interface EndpointData {
  endpoint: { projectId: string; url: string; target: EndpointTarget | null; backendStatus: 'running' | 'unavailable' | 'unlinked' };
  domains: ProjectDomain[];
  hosting: { supported: boolean; customDomains: boolean; apexIps: string[]; localDevelopment?: boolean };
}

const errors: Record<string, string> = {
  invalid_request: 'Check the hostname, target, and port, then try again.',
  container_not_running: 'This container stopped or was replaced. Refresh the list and choose a running container.',
  domain_conflict: 'This hostname is already connected to another project.',
  domain_in_use: 'This hostname is already connected to another project.',
  domain_invalid: 'Enter a valid hostname that you control.',
  invalid_hostname: 'Enter a valid hostname that you control.',
  domain_limit: 'This project has reached its custom domain limit.',
  hosting_unsupported: 'Public endpoints are unavailable in this environment.',
  custom_domains_unavailable: 'Custom domains are unavailable in this environment.',
  project_hosting_unavailable: 'Public endpoints are unavailable in this environment.',
  subscription_required: 'An active plan is required to publish a project endpoint.',
  project_reconciliation_required: 'Endpoint state changed while saving. Refresh the endpoint before trying again.',
  domain_reconciliation_required: 'Domain state changed while saving. Refresh the endpoint before trying again.',
  project_conflict: 'Endpoint settings changed elsewhere. Refresh the endpoint before trying again.',
  ownership_txt_missing: 'Add the ownership TXT record shown below, then check DNS again.',
  routing_dns_missing: 'Add the routing DNS records shown below, then check DNS again. On Cloudflare DNS, use DNS only (gray cloud).',
  domain_verification_unavailable: 'Domain verification is temporarily unavailable. Try again.',
  service_unavailable: 'This service is temporarily unavailable. Refresh the endpoint and try again.',
};

export function parseEndpointData(input: unknown): EndpointData {
  const value = input as EndpointData | null;
  const endpoint = value?.endpoint;
  const hosting = value?.hosting;
  if (!endpoint || typeof endpoint.projectId !== 'string' || typeof endpoint.url !== 'string'
    || !['running', 'unavailable', 'unlinked'].includes(endpoint.backendStatus)
    || !hosting || typeof hosting.supported !== 'boolean' || typeof hosting.customDomains !== 'boolean'
    || hosting.localDevelopment !== undefined && typeof hosting.localDevelopment !== 'boolean'
    || !Array.isArray(hosting.apexIps) || !hosting.apexIps.every(ip => typeof ip === 'string') || !Array.isArray(value?.domains)) throw new Error('invalid_response');
  const target = endpoint.target;
  if (target !== null) {
    if (target?.kind === 'container') {
      if (typeof target.id !== 'string' || !target.id || !validCreatedAt(target.createdAt) || !validPort(target.port)) throw new Error('invalid_response');
    } else if (target?.kind === 'network') {
      if (typeof target.network !== 'string' || !target.network || typeof target.service !== 'string' || !target.service) throw new Error('invalid_response');
    } else throw new Error('invalid_response');
  }
  return { endpoint: { ...endpoint, target }, hosting, domains: value.domains.map(parseDomain) };
}

function validCreatedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function validPort(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535; }
function parseDomain(input: unknown): ProjectDomain {
  const value = input as ProjectDomain | null;
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.hostname !== 'string'
    || !['pending_dns', 'pending_tls', 'active', 'error'].includes(value.status)
    || !['pending', 'verified'].includes(value.dnsStatus) || !['pending', 'active', 'error'].includes(value.tlsStatus)
    || !Array.isArray(value.dnsRecords) || typeof value.error !== 'string' && value.error !== null) throw new Error('invalid_response');
  const records = (rows: unknown[]) => rows.map(row => {
    const record = row as ProjectDomain['dnsRecords'][number];
    if (!record || typeof record.type !== 'string' || typeof record.name !== 'string' || typeof record.value !== 'string'
      || !['ownership', 'routing', 'certificate'].includes(record.purpose)) throw new Error('invalid_response');
    return record;
  });
  return { ...value, dnsRecords: records(value.dnsRecords), ...(value.apexRecords ? { apexRecords: records(value.apexRecords) } : {}) };
}

export function createProjectHostingClient({ fetcher = fetch, onUnauthenticated, signal }: { fetcher?: typeof fetch; onUnauthenticated?: () => void; signal?: AbortSignal } = {}) {
  async function request(path: string, method = 'GET', body?: object, query?: Record<string, string>) {
    const url = new URL(`${API_ORIGIN}${path}`);
    if (query) Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetcher(url, { method, credentials: 'include', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) onUnauthenticated?.();
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(response.status === 401 ? 'not_authenticated' : (typeof data?.error === 'string' ? data.error : 'request_failed'));
    return data;
  }
  return {
    async endpoint(projectId: string) { return parseEndpointData(await request('/projects/endpoint', 'GET', undefined, { id: projectId })); },
    async save(projectId: string, target: EndpointTarget) { return parseEndpointData(await request('/projects/endpoint', 'PUT', { target }, { id: projectId })); },
    async unpublish(projectId: string) { return parseEndpointData(await request('/projects/endpoint', 'DELETE', undefined, { id: projectId })); },
    async domains(projectId: string) { const result = await request('/projects/domains', 'GET', undefined, { id: projectId }); if (!Array.isArray(result?.domains)) throw new Error('invalid_response'); return result.domains.map(parseDomain); },
    async addDomain(projectId: string, hostname: string) { const result = await request('/projects/domains', 'POST', { hostname }, { id: projectId }); return parseDomain(result?.domain); },
    async verifyDomain(projectId: string, domainId: string) { const result = await request('/projects/domains/verify', 'POST', undefined, { id: projectId, domainId }); return parseDomain(result?.domain); },
    async removeDomain(projectId: string, domainId: string) { const result = await request('/projects/domains', 'DELETE', undefined, { id: projectId, domainId }); if (!Array.isArray(result?.domains)) throw new Error('invalid_response'); return result.domains.map(parseDomain); },
    async containers() {
      const result = await request('/containers');
      if (!Array.isArray(result?.containers)) throw new Error('invalid_response');
      return result.containers.filter((item: Container) => item && typeof item.id === 'string' && validCreatedAt(item.createdAt) && typeof item.status === 'string') as Container[];
    },
    async networks() { return privateNetworks(await request('/private-services/networks')); },
    async capabilities() { return await request('/capabilities'); },
  };
}

const labelStatus = (domain: ProjectDomain) => ({ pending_dns: 'DNS pending', pending_tls: 'TLS pending', active: 'Active', error: 'Error' })[domain.status];
const domainErrorText = (error: string | null) => {
  if (!error) return '';
  if (errors[error]) return errors[error];
  return 'DNS or certificate setup needs attention. Check the records below and try again.';
};
export function safeEndpointUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const api = new URL(API_ORIGIN);
    const local = api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname)
      && url.protocol === 'http:' && url.port === api.port && /^p-[a-f0-9]{32}\.localhost$/.test(url.hostname);
    const production = url.protocol === 'https:' && !url.port && /^p-[a-f0-9]{32}\.mainbrella\.dev$/.test(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (!local && !production)) return null;
    return url;
  } catch { return null; }
}
export function safeCustomDomainUrl(hostname: string, localDevelopment = false): URL | null {
  try {
    if (localDevelopment) {
      const api = new URL(API_ORIGIN);
      const label = hostname.endsWith('.localhost') ? hostname.slice(0, -'.localhost'.length) : '';
      if (api.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(api.hostname)
        || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
        || /^p-[a-f0-9]{32}$/.test(label) || /^[a-f0-9]{48}$/.test(label)) return null;
      const url = new URL(`http://${hostname}/`);
      url.port = api.port;
      return url;
    }
    const url = new URL(`https://${hostname}/`);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() !== hostname.toLowerCase()
      || hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) return null;
    return url;
  } catch { return null; }
}
export async function copyDnsValue(value: string, writeText: (text: string) => Promise<void> = text => navigator.clipboard.writeText(text)) {
  try { await writeText(value); return true; } catch { return false; }
}

export function createProjectHosting({ onUnauthenticated, onClose, fetcher = fetch }: { onUnauthenticated: () => void; onClose?: (projectId: string) => void; fetcher?: typeof fetch }) {
  const dialog = document.querySelector<HTMLDialogElement>('#endpoint-dialog')!;
  const title = document.querySelector<HTMLElement>('#endpoint-title')!;
  const status = document.querySelector<HTMLElement>('#endpoint-status')!;
  const error = document.querySelector<HTMLElement>('#endpoint-error')!;
  const targetMode = document.querySelector<HTMLSelectElement>('#endpoint-mode')!;
  const containerField = document.querySelector<HTMLElement>('#endpoint-container-field')!;
  const container = document.querySelector<HTMLSelectElement>('#endpoint-container')!;
  const port = document.querySelector<HTMLInputElement>('#endpoint-port')!;
  const networkField = document.querySelector<HTMLElement>('#endpoint-network-field')!;
  const network = document.querySelector<HTMLSelectElement>('#endpoint-network')!;
  const service = document.querySelector<HTMLSelectElement>('#endpoint-service')!;
  const url = document.querySelector<HTMLAnchorElement>('#endpoint-url')!;
  const save = document.querySelector<HTMLButtonElement>('#endpoint-save')!;
  const unpublish = document.querySelector<HTMLButtonElement>('#endpoint-unpublish')!;
  const domainSection = document.querySelector<HTMLElement>('#endpoint-domains')!;
  const domainList = document.querySelector<HTMLElement>('#endpoint-domain-list')!;
  const domainForm = document.querySelector<HTMLFormElement>('#endpoint-domain-form')!;
  const hostname = document.querySelector<HTMLInputElement>('#endpoint-hostname')!;
  const localNote = document.querySelector<HTMLElement>('#endpoint-local-note')!;
  const records = document.querySelector<HTMLElement>('#endpoint-records')!;
  const apex = document.querySelector<HTMLElement>('#endpoint-apex')!;
  const close = document.querySelector<HTMLButtonElement>('#endpoint-close')!;
  const refresh = document.querySelector<HTMLButtonElement>('#endpoint-refresh')!;
  let requestAbort = new AbortController();
  let client = createProjectHostingClient({ fetcher, onUnauthenticated, signal: requestAbort.signal });
  let currentProject: { id: string; name: string } | null = null;
  let data: EndpointData | null = null;
  let containers: Container[] = [];
  let networks: PrivateNetwork[] = [];
  let networkingSupported = false;
  let catalogError = false;
  let busy = false, disposed = false, epoch = 0;
  const identities = new Map<string, Container>();

  function feedback(message = '', isError = false) { status.textContent = isError ? '' : message; error.textContent = isError ? message : ''; error.hidden = !isError; }
  function controls() {
    dialog.setAttribute('aria-busy', String(busy));
    const locked = busy || disposed;
    for (const node of [targetMode, container, port, network, service, hostname, save] as (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[]) node.disabled = locked || (node === save && !data?.hosting.supported) || (node === network && !networkingSupported) || (node === service && !networkingSupported);
    unpublish.disabled = locked || !data?.endpoint.target;
    close.disabled = disposed;
    document.querySelector<HTMLButtonElement>('#endpoint-domain-add')!.disabled = locked || !data?.hosting.customDomains;
    refresh.disabled = locked;
    dialog.querySelectorAll?.<HTMLButtonElement>('[data-endpoint-action]').forEach(button => { button.disabled = locked || button.dataset.unavailable === 'true'; });
  }
  function refreshServices() {
    network.replaceChildren();
    for (const item of networks) { const option = document.createElement('option'); option.value = item.name; option.textContent = item.name; network.append(option); }
    fillService();
  }
  function fillService() {
    service.replaceChildren();
    const selected = networks.find(item => item.name === network.value);
    for (const member of selected?.members ?? []) {
      if (member.port === undefined || member.port < 1024 || !containers.some(machine => machine.status === 'running' && generationKey(machine) === generationKey(member))) continue;
      const option = document.createElement('option'); option.value = member.name; option.textContent = `${member.name} · ${member.port}`; service.append(option);
    }
  }
  function addRecordRow(host: HTMLElement, record: { type: string; name: string; value: string }) {
    const row = document.createElement('tr');
    for (const value of [record.type, record.name, record.value]) { const cell = document.createElement('td'), text = document.createElement('code'); text.textContent = value; cell.append(text); row.append(cell); }
    const action = document.createElement('td');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = 'Copy'; button.setAttribute('aria-label', `Copy ${record.type} record ${record.name}`);
    button.addEventListener('click', async () => {
      if (await copyDnsValue(record.value)) { button.textContent = 'Copied'; setTimeout(() => { if (!disposed) button.textContent = 'Copy'; }, 1500); }
      else feedback('Could not copy this DNS value. Select and copy it manually.', true);
    }); action.append(button); row.append(action); host.append(row);
  }
  function renderDomains() {
    domainList.replaceChildren(); records.replaceChildren(); apex.replaceChildren();
    for (const item of data?.domains ?? []) {
      const row = document.createElement('div'); row.className = 'endpoint-domain-row';
      const domainUrl = safeCustomDomainUrl(item.hostname, data?.hosting.localDevelopment === true);
      const name = item.status === 'active' && data?.endpoint.backendStatus === 'running' && domainUrl
        ? document.createElement('a') : document.createElement('strong');
      name.textContent = item.hostname;
      if (name.tagName === 'A' && domainUrl) { const anchor = name as HTMLAnchorElement; anchor.href = domainUrl.href; anchor.target = '_blank'; anchor.rel = 'noopener'; }
      const state = document.createElement('span'); state.textContent = labelStatus(item); state.className = 'dashboard-status';
      row.append(name, state);
      const humanError = domainErrorText(item.error);
      if (humanError) { const detail = document.createElement('p'); detail.className = 'dashboard-error'; detail.textContent = humanError; row.append(detail); }
      const check = document.createElement('button'); check.type = 'button'; check.className = 'dashboard-retry'; check.textContent = data?.hosting.localDevelopment && item.status === 'pending_tls' ? 'Activate locally' : item.status === 'active' ? 'Check DNS' : 'Verify DNS'; check.dataset.endpointAction = 'true';
      check.dataset.unavailable = String(!data?.hosting.customDomains);
      check.addEventListener('click', () => operate(async projectId => { const updated = await client.verifyDomain(projectId, item.id); return () => replaceDomain(updated); })); row.append(check);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'dashboard-retry'; remove.textContent = 'Remove'; remove.dataset.endpointAction = 'true'; remove.addEventListener('click', () => { if (!window.confirm(`Remove ${item.hostname} from this project?`)) return; return operate(async projectId => { const domains = await client.removeDomain(projectId, item.id); return () => { if (data) data.domains = domains; }; }); }); row.append(remove);
      if (item.routingNote) { const note = document.createElement('p'); note.className = 'dashboard-status'; note.textContent = item.routingNote; row.append(note); }
      domainList.append(row);
      const headingRow = document.createElement('tr'), heading = document.createElement('th'); heading.colSpan = 4; heading.scope = 'rowgroup'; heading.textContent = `DNS records for ${item.hostname}`; headingRow.append(heading); records.append(headingRow);
      for (const record of item.dnsRecords) addRecordRow(records, record);
      const apexRecords = item.apexRecords ?? [];
      if (apexRecords.length) {
        const headingRow = document.createElement('tr'), heading = document.createElement('th'); heading.colSpan = 4; heading.scope = 'rowgroup'; heading.textContent = `Apex routing for ${item.hostname}`; headingRow.append(heading); apex.append(headingRow);
        for (const record of apexRecords) addRecordRow(apex, record);
      }
    }
    const localDevelopment = data?.hosting.localDevelopment === true;
    hostname.placeholder = localDevelopment ? 'app.localhost' : 'app.example.com';
    localNote.hidden = !localDevelopment || !data?.hosting.customDomains;
    localNote.textContent = localDevelopment ? 'DNS and TLS are simulated locally. Click Verify DNS twice to activate the alias.' : '';
    domainForm.hidden = !data?.hosting.customDomains;
    domainSection.hidden = !data || (!data.hosting.customDomains && data.domains.length === 0);
  }
  function replaceDomain(updated: ProjectDomain) { const at = data!.domains.findIndex(item => item.id === updated.id); if (at < 0) data!.domains.push(updated); else data!.domains[at] = updated; renderDomains(); }
  function render() {
    if (!data || !currentProject) return;
    title.textContent = `Endpoint · ${currentProject.name}`;
    const linked = data.endpoint.target !== null;
    const safeUrl = safeEndpointUrl(data.endpoint.url);
    url.hidden = !linked || data.endpoint.backendStatus !== 'running' || !safeUrl;
    if (safeUrl) url.href = safeUrl.href;
    url.textContent = safeUrl?.href ?? '';
    unpublish.hidden = !linked;
    if (!data.hosting.supported) feedback('Public endpoints are unavailable in this environment.');
    else if (catalogError) feedback('Endpoint loaded, but target options could not be refreshed. Retry to load current containers and networks.', true);
    else if (!linked) feedback('Choose a running container or registered network service to publish a public URL.');
    else feedback(data.endpoint.backendStatus === 'running' ? 'Endpoint is running.' : 'The linked target is unavailable. Start it, then select it and publish again.');
    const target = data.endpoint.target;
    targetMode.value = target?.kind ?? 'container';
    if (target?.kind === 'container') { const key = JSON.stringify([target.id, target.createdAt]); if (!identities.has(key)) { const option = document.createElement('option'); option.value = key; option.textContent = `${target.id} (replaced or stopped)`; container.append(option); identities.set(key, { id: target.id, createdAt: target.createdAt, status: 'unavailable', expiresAt: 0 }); } container.value = key; port.value = String(target.port); }
    if (target?.kind === 'network') { network.value = target.network; fillService(); service.value = target.service; }
    containerField.hidden = targetMode.value !== 'container'; networkField.hidden = targetMode.value !== 'network';
    save.disabled = busy || disposed || !data.hosting.supported || catalogError;
    renderDomains(); controls();
  }
  async function load() {
    const id = currentProject!.id, at = epoch;
    busy = true; feedback('Loading endpoint…'); controls();
    try {
      const endpoint = await client.endpoint(id);
      if (disposed || epoch !== at) return;
      data = endpoint;
      renderDomains();
      const caps = await client.capabilities().catch(() => null);
      if (disposed || epoch !== at) return;
      networkingSupported = caps?.networking?.privateServices === true;
      targetMode.querySelectorAll?.('option').forEach((option: HTMLOptionElement) => { if (option.value === 'network') option.disabled = !networkingSupported; });
      const results = await Promise.allSettled([client.containers(), ...(networkingSupported ? [client.networks()] : [])]);
      if (disposed || epoch !== at) return;
      catalogError = results.some(result => result.status === 'rejected');
      containers = results[0]?.status === 'fulfilled' ? results[0].value as Container[] : [];
      networks = networkingSupported && results[1]?.status === 'fulfilled' ? results[1].value as PrivateNetwork[] : [];
      identities.clear(); container.replaceChildren();
      for (const item of containers) if (item.status === 'running') { const key = generationKey(item); identities.set(key, item); const option = document.createElement('option'); option.value = key; option.textContent = item.name || item.id; container.append(option); }
      refreshServices(); render();
    } catch (caught) { if (!disposed && epoch === at) feedback(errors[(caught as Error)?.message] ?? 'Could not load endpoint settings. Check your connection and try again.', true); }
    finally { if (!disposed && epoch === at) { busy = false; controls(); } }
  }
  async function operate(action: (projectId: string) => Promise<() => void>) {
    if (busy || disposed || !currentProject || !data) return;
    const at = epoch, projectId = currentProject.id; busy = true; controls(); feedback('Saving…');
    try { const apply = await action(projectId); if (disposed || epoch !== at || currentProject?.id !== projectId) return; apply(); feedback(''); render(); }
    catch (caught) { if (disposed || epoch !== at) return; const code = (caught as Error)?.message ?? ''; feedback(data?.hosting.localDevelopment && ['invalid_hostname', 'domain_invalid'].includes(code) ? 'Use one local hostname such as app.localhost.' : errors[code] ?? 'Could not confirm this change. Refresh the endpoint before trying again.', true); }
    finally { if (!disposed && epoch === at) { busy = false; controls(); } }
  }
  targetMode.addEventListener('change', () => { containerField.hidden = targetMode.value !== 'container'; networkField.hidden = targetMode.value !== 'network'; controls(); });
  network.addEventListener('change', fillService);
  save.addEventListener('click', () => {
    let target: EndpointTarget;
    if (targetMode.value === 'container') {
      const machine = identities.get(container.value); const appPort = Number(port.value);
      if (!machine || machine.status !== 'running' || !Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) { feedback('Choose a running container and a valid application port from 1024 to 65535.', true); return; }
      target = { kind: 'container', id: machine.id, createdAt: machine.createdAt, port: appPort };
    } else if (targetMode.value === 'network' && networks.some(item => item.name === network.value && item.members.some(member => member.name === service.value && member.port !== undefined && member.port >= 1024 && containers.some(machine => machine.status === 'running' && generationKey(machine) === generationKey(member))))) target = { kind: 'network', network: network.value, service: service.value };
    else { feedback('Choose a registered network service.', true); return; }
    operate(async projectId => { const updated = await client.save(projectId, target); return () => { data = updated; }; });
  });
  unpublish.addEventListener('click', () => { if (!window.confirm('Unpublish this endpoint? Domain registrations will remain.')) return; operate(async projectId => { const updated = await client.unpublish(projectId); return () => { data = updated; }; }); });
  domainForm.addEventListener('submit', event => { event.preventDefault(); const value = hostname.value.trim(); if (!value) return; operate(async projectId => { const added = await client.addDomain(projectId, value); return () => { hostname.value = ''; replaceDomain(added); }; }); });
  refresh.addEventListener('click', () => { if (!busy && currentProject) { catalogError = false; load(); } });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { const projectId = currentProject?.id; epoch++; requestAbort.abort(); currentProject = null; data = null; busy = false; feedback(''); records.replaceChildren(); apex.replaceChildren(); domainList.replaceChildren(); if (projectId) onClose?.(projectId); });
  return {
    open(project: { id: string; name: string; domain?: string | null }) { if (disposed) return; epoch++; requestAbort.abort(); requestAbort = new AbortController(); client = createProjectHostingClient({ fetcher, onUnauthenticated, signal: requestAbort.signal }); currentProject = project; data = null; catalogError = false; containers = []; networks = []; hostname.value = project.domain ?? ''; port.value = '3000'; targetMode.value = 'container'; container.value = ''; network.value = ''; service.value = ''; identities.clear(); feedback(''); domainSection.hidden = true; localNote.hidden = true; dialog.showModal(); load(); },
    dispose() { disposed = true; epoch++; requestAbort.abort(); dialog.close(); controls(); },
  };
}
