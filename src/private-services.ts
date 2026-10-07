import { API_ORIGIN } from './auth.ts';
import { createSearchPicker } from './search-picker.ts';
import type { ClientOptions, Container, ContainerIdentity } from './types.ts';

export interface PrivateMember extends ContainerIdentity { name: string; port?: number }
export interface PrivateNetwork { name: string; members: PrivateMember[] }
export const validPrivateName = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
export const validPrivatePort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
export const generationKey = (machine: ContainerIdentity) => JSON.stringify([machine.id, machine.createdAt]);

export function privateMember(input: unknown): PrivateMember {
  const value = input as PrivateMember | null;
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt
    || !validPrivateName(value.name) || (value.port !== undefined && !validPrivatePort(value.port))) throw new Error('invalid_response');
  return { id: value.id, createdAt: value.createdAt, name: value.name, ...(value.port === undefined ? {} : { port: value.port }) };
}

export function privateNetworks(input: unknown): PrivateNetwork[] {
  const value = input as { networks?: PrivateNetwork[] } | null;
  if (!Array.isArray(value?.networks)) throw new Error('invalid_response');
  const names = new Set<string>(), machines = new Set<string>();
  return value.networks.map(network => {
    if (!validPrivateName(network?.name) || names.has(network.name) || !Array.isArray(network.members)) throw new Error('invalid_response');
    names.add(network.name);
    const services = new Set<string>();
    const members = network.members.map(input => {
      const member = privateMember(input), key = generationKey(member);
      if (services.has(member.name) || machines.has(key)) throw new Error('invalid_response');
      services.add(member.name); machines.add(key);
      return member;
    });
    return { name: network.name, members };
  });
}

const messages: Record<string, string> = {
  network_name_conflict: 'This network name is already in use. Choose another name.',
  service_name_conflict: 'This service name is already in use in this network.',
  machine_already_attached: 'This machine already belongs to another network. Detach it first.',
  network_not_empty: 'Detach every machine before deleting this network.',
  container_not_running: 'This machine has stopped or been replaced. Refresh containers and select a running machine.',
  network_not_found: 'This network no longer exists. Refresh Private Services.',
  network_limit: 'Your network limit has been reached. Delete an empty network first.',
  network_member_limit: 'This network has reached its machine limit.',
  invalid_request: 'Check the name and application port, then try again.',
  subscription_required: 'An active plan is required to use Private Services.',
  private_services_unsupported: 'Private Services are unavailable in this environment.',
};

export function createPrivateServicesClient({ fetcher = fetch, onUnauthenticated, signal }: ClientOptions = {}) {
  async function request(path: 'networks' | 'members', method = 'GET', network?: string, body?: object, query?: { search: string; page: number; limit: number }) {
    const url = new URL(`${API_ORIGIN}/private-services/${path}`);
    if (network !== undefined) url.searchParams.set('network', network);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetcher(url, { method, credentials: 'include', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) onUnauthenticated?.();
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(Object.hasOwn(messages, result?.error ?? '') ? result.error : 'private_services_unavailable');
    return result;
  }
  return {
    async list() { return privateNetworks(await request('networks')); },
    async listPage(query: { search: string; page: number; limit: number }) {
      const result = await request('networks', 'GET', undefined, undefined, query);
      const networks = privateNetworks(result);
      if (![result.total, result.totalNetworks, result.page, result.limit].every(Number.isSafeInteger)
        || result.total < networks.length || result.totalNetworks < result.total || result.page < 1
        || result.limit !== query.limit || networks.length > result.limit) throw new Error('invalid_response');
      return { networks, total: result.total as number, page: result.page as number };
    },
    async create(name: string) {
      if (!validPrivateName(name)) throw new Error('invalid_request');
      const result = await request('networks', 'POST', undefined, { name });
      const [network] = privateNetworks({ networks: [result] });
      if (network.name !== name || network.members.length) throw new Error('invalid_response');
      return network;
    },
    async delete(network: string) {
      const result = await request('networks', 'DELETE', network);
      if (result?.deleted !== true) throw new Error('invalid_response');
    },
    async attach(network: string, input: PrivateMember) {
      const member = privateMember(input);
      const result = await request('members', 'PUT', network, member);
      if (result?.network !== network || JSON.stringify(privateMember(result)) !== JSON.stringify(member)) throw new Error('invalid_response');
    },
    async detach(network: string, member: PrivateMember) {
      const { id, createdAt, name } = privateMember(member);
      const result = await request('members', 'DELETE', network, { id, createdAt, name });
      if (result?.detached !== true) throw new Error('invalid_response');
    },
  };
}

function button(text: string, click: () => void, action: string) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'dashboard-retry'; node.textContent = text; node.dataset.action = action; node.onclick = click;
  return node;
}

export function createPrivateServices({ onUnauthenticated, onChanged }: { onUnauthenticated: () => void; onChanged: () => void }) {
  const host = document.querySelector<HTMLElement>('#private-services-feedback')!;
  const status = host.querySelector<HTMLElement>('[role="status"]')!;
  const error = host.querySelector<HTMLElement>('[role="alert"]')!;
  const refresh = host.querySelector<HTMLButtonElement>('button')!;
  const newNetwork = document.querySelector<HTMLButtonElement>('#network-create-open')!;
  const networkDialog = document.querySelector<HTMLDialogElement>('#network-create-dialog')!;
  const networkForm = networkDialog.querySelector<HTMLFormElement>('form')!;
  const networkName = networkForm.querySelector<HTMLInputElement>('input')!;
  const memberDialog = document.querySelector<HTMLDialogElement>('#private-member-dialog')!;
  const memberForm = memberDialog.querySelector<HTMLFormElement>('form')!;
  const networkPicker = createSearchPicker(memberForm.querySelector<HTMLInputElement>('#private-member-network')!, () => controls());
  const machinePicker = createSearchPicker(memberForm.querySelector<HTMLInputElement>('#private-member-machine')!, () => controls());
  const serviceName = memberForm.querySelector<HTMLInputElement>('#private-member-name')!;
  const port = memberForm.querySelector<HTMLInputElement>('#private-member-port')!;
  const submit = memberForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const networkUsage = document.querySelector<HTMLElement>('#usage-networks-group')!;
  const networkCount = document.querySelector<HTMLElement>('#usage-networks')!;
  const networkDetail = document.querySelector<HTMLElement>('#usage-networks-detail')!;
  const containerDetail = document.querySelector<HTMLElement>('#usage-network-containers')!;
  const filters = document.querySelector<HTMLElement>('#network-filters')!;
  const search = document.querySelector<HTMLInputElement>('#network-search')!;
  const pagination = document.querySelector<HTMLElement>('#network-pagination')!;
  const previous = document.querySelector<HTMLButtonElement>('#networks-previous')!;
  const next = document.querySelector<HTMLButtonElement>('#networks-next')!;
  const range = document.querySelector<HTMLElement>('#networks-range')!;
  const noResults = document.querySelector<HTMLElement>('#networks-empty')!;
  const pageSize = 10;
  let visibleNetworks: PrivateNetwork[] = [], page = 1, total = 0, pageVersion = 0, pageBusy = false, pageKnown = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const collapse = new Map<string, boolean>();
  const abort = new AbortController();
  const client = createPrivateServicesClient({ onUnauthenticated, signal: abort.signal });
  let networks: PrivateNetwork[] = [], containers: Container[] = [];
  const memberships = new Map<string, { network: string; member: PrivateMember }>();

  function setNetworks(value: PrivateNetwork[]) {
    networks = value;
    memberships.clear();
    for (const network of networks) for (const member of network.members) {
      memberships.set(generationKey(member), { network: network.name, member });
    }
  }
  let active = false;
  let supported = false, known = false, busy = false, externalBusy = false, disposed = false, version = 0;
  let editing: { network: string; member: PrivateMember } | null = null;

  function controls() {
    host.hidden = !active;
    filters.hidden = !active || !known || (!networks.length && !search.value);
    pagination.hidden = !active || !known || total <= pageSize;
    noResults.hidden = !active || !known || !pageKnown || pageBusy || total !== 0;
    noResults.textContent = search.value.trim() ? 'No networks match your search.' : 'You haven\'t created any networks.';
    previous.disabled = busy || externalBusy || disposed || pageBusy || page <= 1;
    next.disabled = busy || externalBusy || disposed || pageBusy || page * pageSize >= total;
    range.textContent = `${total ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, total)} of ${total} networks`;
    const disabled = busy || externalBusy || disposed || pageBusy;
    const issuanceDisabled = disabled || !supported;
    newNetwork.hidden = !active || !supported; newNetwork.disabled = issuanceDisabled || !known;
    refresh.disabled = disabled;
    networkForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button[type="submit"]').forEach(node => { node.disabled = issuanceDisabled || !known; });
    memberForm.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, select, button[type="submit"]').forEach(node => { node.disabled = issuanceDisabled || !known; });
    networkPicker.disabled = issuanceDisabled || !known || Boolean(editing);
    machinePicker.disabled = issuanceDisabled || !known || Boolean(editing);
    const machine = containers.find(value => generationKey(value) === machinePicker.value);
    submit.disabled ||= !networkPicker.value || !machine || machine.status !== 'running';
    document.querySelectorAll<HTMLButtonElement>('[data-private-control]').forEach(node => {
      node.disabled = disabled || !known || node.dataset.unavailable === 'true';
    });
  }

  function feedback(message: string, isError = false) {
    status.textContent = isError ? '' : message;
    error.textContent = isError ? message : ''; error.hidden = !isError;
  }

  async function loadPage() {
    clearTimeout(searchTimer);
    const current = ++pageVersion;
    pageBusy = true; controls();
    try {
      const result = await client.listPage({ search: search.value.trim(), page, limit: pageSize });
      if (disposed || current !== pageVersion) return;
      visibleNetworks = result.networks; page = result.page; total = result.total; pageKnown = true;
      feedback('');
    } catch {
      if (disposed || current !== pageVersion) return;
      visibleNetworks = []; total = 0; pageKnown = false;
      host.hidden = false;
      feedback('Could not load network results. Refresh Private Services to try again.', true);
    } finally {
      if (!disposed && current === pageVersion) { pageBusy = false; onChanged(); controls(); }
    }
  }

  search.addEventListener('input', () => {
    page = 1; pageVersion++; pageBusy = true; controls();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadPage(), 250);
  });
  previous.onclick = () => { if (!previous.disabled) { page--; loadPage(); } };
  next.onclick = () => { if (!next.disabled) { page++; loadPage(); } };

  async function load() {
    if (disposed || busy) return;
    const current = version;
    busy = true; controls();
    if (!known && supported) feedback('Loading Private Services…');
    try {
      const result = await client.list();
      if (disposed || current !== version) return;
      setNetworks(result); known = true; host.hidden = !supported && !networks.length; feedback(''); await loadPage(); onChanged();
    } catch {
      if (disposed || current !== version) return;
      known = false;
      if (supported || networks.length) {
        host.hidden = false;
        feedback('Could not load Private Services. Refresh to check network membership.', true);
      }
      onChanged();
    } finally { busy = false; controls(); }
  }

  async function operate(action: () => Promise<unknown>, message: string, dialog?: HTMLDialogElement) {
    if (busy || externalBusy || disposed || !known || (dialog && !supported)) return;
    const current = version;
    busy = true; controls();
    const dialogError = dialog?.querySelector<HTMLElement>('[role="alert"]');
    if (dialogError) dialogError.hidden = true;
    feedback('Saving…');
    let succeeded = false;
    try {
      await action();
      if (disposed || current !== version) return;
      succeeded = true; dialog?.close();
    } catch (caught) {
      if (disposed || current !== version) return;
      const code = caught instanceof Error ? caught.message : '';
      const message = messages[code] ?? 'Change could not be confirmed. Refresh Private Services before retrying.';
      if (dialogError) { dialogError.textContent = message; dialogError.hidden = false; }
      feedback(message, true);
    } finally {
      if (!disposed && current === version) {
        // Reconcile even after an ambiguous write. Never replay a mutation.
        try {
          const result = await client.list();
          if (disposed || current !== version) return;
          setNetworks(result); known = true;
          await loadPage();
          host.hidden = !supported && !networks.length;
        }
        catch {
          if (disposed || current !== version) return;
          known = false; feedback('Could not refresh Private Services. Check membership before making another change.', true);
        }
        if (!disposed && current === version) {
          if (succeeded && known) feedback(message);
          onChanged(); controls();
        }
      }
      busy = false; controls();
    }
  }

  function populateMachines() {
    const choices = containers.filter(machine => machine.status === 'running' && (!membership(machine) || generationKey(machine) === generationKey(editing?.member ?? { id: '', createdAt: '' })));
    machinePicker.setOptions(choices.map(machine => ({
      value: generationKey(machine), label: `${machine.name || machine.id} · ${machine.imageName || machine.size || machine.id}`, search: machine.id,
    })));
  }

  function openMember(network?: string, machine?: Container, member?: PrivateMember) {
    if (busy || externalBusy || !known || !supported) return;
    editing = member && network ? { network, member } : null;
    memberDialog.querySelector<HTMLElement>('h2')!.textContent = member ? 'Edit private service' : 'Attach machine';
    submit.textContent = member ? 'Save service' : 'Attach machine';
    networkPicker.setOptions(networks.map(item => ({ value: item.name, label: item.name })));
    networkPicker.value = network ?? '';
    populateMachines(); machinePicker.value = machine ? generationKey(machine) : '';
    serviceName.value = member?.name ?? ''; port.value = member?.port === undefined ? '' : String(member.port);
    memberDialog.querySelector<HTMLElement>('[role="alert"]')!.hidden = true;
    controls(); memberDialog.showModal();
    (member ? serviceName : machine ? networkPicker : machinePicker).focus();
  }

  function membership(machine: ContainerIdentity) {
    return memberships.get(generationKey(machine)) ?? null;
  }

  function privateButton(text: string, click: () => void, unavailable = false) {
    const node = button(text, click, `private-${text.toLowerCase().replaceAll(' ', '-')}`);
    node.dataset.privateControl = 'true'; node.dataset.unavailable = String(unavailable);
    return node;
  }
  function detach(network: string, member: PrivateMember) {
    if (window.confirm(`Detach ${member.name} from ${network}? Private service access will end.`)) {
      operate(() => client.detach(network, member), 'Machine detached.');
    }
  }

  networkForm.onsubmit = event => {
    event.preventDefault();
    if (networkForm.reportValidity()) operate(() => client.create(networkName.value), 'Network created.', networkDialog);
  };
  memberForm.onsubmit = event => {
    event.preventDefault();
    const machine = containers.find(value => generationKey(value) === machinePicker.value && value.status === 'running');
    if (!memberForm.reportValidity() || !machine || !validPrivateName(serviceName.value) || (port.value !== '' && !validPrivatePort(port.valueAsNumber))) return;
    const member = { id: machine.id, createdAt: machine.createdAt, name: serviceName.value, ...(port.value === '' ? {} : { port: port.valueAsNumber }) };
    const network = editing?.network ?? networkPicker.value;
    if (networks.some(value => value.name === network)) operate(() => client.attach(network, member), 'Private service saved.', memberDialog);
  };
  newNetwork.onclick = () => { networkForm.reset(); networkDialog.querySelector<HTMLElement>('[role="alert"]')!.hidden = true; networkDialog.showModal(); networkName.focus(); };
  refresh.onclick = () => load();
  for (const dialog of [networkDialog, memberDialog]) dialog.querySelector<HTMLButtonElement>('[data-private-close]')!.onclick = () => dialog.close();

  return {
    setVisible(value: boolean) { active = value; controls(); },
    get networks() { return known ? networks : []; },
    get supported() { return supported; },
    get visible() { return supported || networks.length > 0; },
    get stateKey() { return JSON.stringify([supported, known, networks, visibleNetworks]); },
    membership(machine: ContainerIdentity) { return known ? membership(machine) : null; },
    sync(machines: Container[]) {
      containers = machines;
      if (memberDialog.open) { populateMachines(); controls(); }
      const attached = known ? machines.filter(machine => membership(machine)).length : 0;
      containerDetail.hidden = !this.visible;
      containerDetail.textContent = known ? `${machines.length - attached} standalone · ${attached} in networks` : 'Network membership unavailable';
      networkUsage.hidden = !this.visible; networkCount.textContent = known ? String(networks.length) : '—';
      networkDetail.textContent = known ? `${networks.length} private ${networks.length === 1 ? 'network' : 'networks'}` : 'Membership unavailable';
    },
    configure(enabled: boolean) {
      if (disposed) return;
      const changed = supported !== enabled;
      supported = enabled; host.hidden = !this.visible;
      // The capability gates issuance, not inspection or revocation. Always
      // discover existing registrations, including after a disabled-page reload.
      if (!enabled) { networkDialog.close(); memberDialog.close(); }
      controls();
      if (changed || !busy) load();
    },
    setBusy(value: boolean) { externalBusy = value; controls(); },
    attach(actions: HTMLElement, machine: Container) {
      if (!known) return;
      const member = membership(machine);
      if (supported) actions.append(privateButton(member ? 'Edit service' : 'Attach to network', () => openMember(member?.network, machine, member?.member), machine.status !== 'running' || !networks.length));
      if (member) actions.append(privateButton('Detach', () => detach(member.network, member.member)));
    },
    buildGroups(list: HTMLElement, machines: Container[], view: 'containers' | 'networks', renderMembers: (body: HTMLTableSectionElement, members: Container[]) => void) {
      const machinesByNetwork = new Map<string, Container[]>();
      for (const machine of machines) {
        const key = this.membership(machine)?.network ?? '';
        const members = machinesByNetwork.get(key) ?? [];
        members.push(machine); machinesByNetwork.set(key, members);
      }
      const machineKeys = new Set(containers.map(generationKey));
      const groups = view === 'networks' ? (known ? visibleNetworks : []) : [null];
      for (const network of groups) {
        const key = network?.name ?? '', members = machinesByNetwork.get(key) ?? [];
        if (!network && !members.length) continue;
        const group = document.createElement('details'); group.className = 'machine-group'; group.open = collapse.get(key) ?? !network;
        const summary = document.createElement('summary');
        const title = document.createElement('strong'); title.textContent = network?.name ?? (this.visible && !known ? 'Containers' : 'Standalone containers');
        const count = document.createElement('span'); count.className = 'section-count'; count.textContent = String(network?.members.length ?? members.length);
        const label = document.createElement('span'); label.className = 'private-service-badge'; label.textContent = 'Private Services';
        const note = document.createElement('span'); note.className = 'dashboard-status group-note';
        note.textContent = network ? 'Private HTTP services · public previews are opt-in' : this.visible && !known ? 'Network membership unavailable' : 'Containers without private service attachments';
        summary.append(title, count); if (network) summary.append(label); summary.append(note); group.append(summary);
        let populated = false;
        const populate = () => {
          if (populated) return;
          populated = true;
          if (network) {
            const tools = document.createElement('div'); tools.className = 'container-actions group-tools';
            if (supported) tools.append(privateButton('Attach machine', () => openMember(network.name), !containers.some(machine => machine.status === 'running' && !membership(machine))));
            tools.append(privateButton('Delete network', () => { if (window.confirm(`Delete empty network ${network.name}?`)) operate(() => client.delete(network.name), 'Network deleted.'); }, network.members.length > 0));
            tools.lastElementChild!.setAttribute('title', network.members.length ? 'Detach all machines before deleting this network.' : 'Delete this empty network');
            group.append(tools);
          }
          const table = document.createElement('table'); table.className = 'machine-table'; table.setAttribute('aria-label', network ? `Machines in ${network.name}` : 'Standalone containers');
          const head = table.createTHead().insertRow();
          for (const [index, text] of ['Name', 'Status', 'Image', 'Private service', 'Last started', 'Actions'].entries()) {
            const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; cell.className = `machine-column-${index}`; head.append(cell);
          }
          const body = table.createTBody(); group.append(table);
          if (network) for (const member of network.members.filter(member => !machineKeys.has(generationKey(member)))) {
            const row = body.insertRow(); row.className = 'machine-table-row stale-member';
            const info = row.insertCell(); info.textContent = member.name;
            const identity = document.createElement('code'); identity.className = 'machine-identity'; identity.textContent = member.id; info.append(identity);
            row.insertCell().textContent = containers.some(machine => machine.id === member.id) ? 'Replaced' : 'Not running';
            row.insertCell().textContent = '—';
            const address = row.insertCell(); address.textContent = member.port === undefined ? 'Caller only' : `http://${member.name}.internal → ${member.port}`;
            row.insertCell().textContent = new Date(member.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            row.insertCell().append(privateButton('Detach', () => detach(network.name, member)));
            [...row.cells].forEach((cell, index) => { cell.className += ` machine-column-${index}`; cell.dataset.label = head.cells[index].textContent!; });
          }
          if (network && !network.members.length) { const cell = body.insertRow().insertCell(); cell.colSpan = 6; cell.className = 'dashboard-status group-empty'; cell.textContent = 'No machines attached.'; }
          renderMembers(body, members);
          controls();
        };
        group.ontoggle = () => {
          if (!group.isConnected) return;
          collapse.set(key, group.open);
          if (group.open) populate();
        };
        // Collapsed networks only need their summary until the user opens them.
        if (group.open) populate();
        list.append(group);
      }
    },
    dispose() { disposed = true; version++; pageVersion++; clearTimeout(searchTimer); abort.abort(); networkDialog.close(); memberDialog.close(); setNetworks([]); host.hidden = true; filters.hidden = true; pagination.hidden = true; noResults.hidden = true; },
  };
}
