import { trackMachineStart } from './acquisition-analytics.ts';
import type { Container, ContainerData, ContainerIdentity, ContainerLimits, MachineSize, Image, ObservabilityCapabilities, PersistenceCapabilities } from './types.ts';
import { API_ORIGIN } from './auth.ts';
import { createContainerPreviews } from './container-previews.ts';
import { createContainerObservations } from './container-observations.ts';
import { createWorkspacesDashboard } from './workspaces-dashboard.ts';
import { createPrivateServices } from './private-services.ts';

type CreationState = {
  active: boolean; containers: unknown[];
  limits: Pick<ContainerLimits, 'maxContainers' | 'maxStartsPerMonth' | 'maxConcurrentComputeUnits'>;
  usage: Pick<ContainerData['usage'], 'starts' | 'availableComputeUnitHours' | 'concurrentComputeUnits'>;
  sizes?: Pick<MachineSize, 'id' | 'computeUnits'>[];
};

export function canCreateContainer(data: CreationState | null, size = 'lite') {
  return Boolean(data && (!data.active || (
    data.containers.length < data.limits.maxContainers
      && data.usage.starts < data.limits.maxStartsPerMonth
      && (data.usage.availableComputeUnitHours === undefined || data.usage.availableComputeUnitHours > 0)
      && (data.limits.maxConcurrentComputeUnits === undefined || (data.usage.concurrentComputeUnits ?? 0) + (data.sizes?.find(item => item.id === size)?.computeUnits ?? 1) <= data.limits.maxConcurrentComputeUnits)
  )));
}

export function imageSelection(value: string) {
  return value.startsWith('catalog:') ? { catalogId: value.slice(8) }
    : value ? { imageId: value } : null;
}

export function createContainersDashboard({ onUnauthenticated }: { onUnauthenticated: () => void }) {
  const sizePicker = document.querySelector<HTMLFieldSetElement>('#container-size')!;
  const sizeOptions = document.querySelector<HTMLElement>('#machine-options')!;
  const selectedSize = () => sizePicker.querySelector<HTMLInputElement>('input:checked')?.value ?? 'lite';
  const sizeRate = document.querySelector<HTMLElement>('#container-size-rate')!;
  let sizeOptionsKey = '';
  const containerName = document.querySelector<HTMLInputElement>('#container-name')!;
  const launchForm = document.querySelector<HTMLFormElement>('#container-launch-form')!;
  const imageSelect = document.querySelector<HTMLSelectElement>('#container-image')!;
  const create = document.querySelector<HTMLButtonElement>('#container-create')!;
  const launch = document.querySelector<HTMLDialogElement>('#container-launch-dialog')!;
  const openLaunch = document.querySelector<HTMLButtonElement>('#container-launch-open')!;
  const launchStatus = document.querySelector<HTMLElement>('#container-launch-status')!;
  const launchError = document.querySelector<HTMLElement>('#container-launch-error')!;
  const refresh = document.querySelector<HTMLButtonElement>('#containers-refresh')!;
  const list = document.querySelector<HTMLElement>('#container-list')!;
  const status = document.querySelector<HTMLElement>('#containers-status')!;
  const empty = document.querySelector<HTMLElement>('#containers-empty')!;
  const count = document.querySelector<HTMLElement>('#container-count')!;
  const usage = document.querySelector<HTMLElement>('#container-usage')!;
  const usageContainers = document.querySelector<HTMLElement>('#usage-containers')!;
  const usageConcurrency = document.querySelector<HTMLElement>('#usage-concurrency')!;
  const usageCompute = document.querySelector<HTMLElement>('#usage-compute')!;
  const usageComputeDetail = document.querySelector<HTMLElement>('#usage-compute-detail')!;
  const usageStarts = document.querySelector<HTMLElement>('#usage-starts')!;
  const usageStartsDetail = document.querySelector<HTMLElement>('#usage-starts-detail')!;
  const error = document.querySelector<HTMLElement>('#containers-error')!;
  const pagination = document.querySelector<HTMLElement>('#container-pagination')!;
  const previous = document.querySelector<HTMLButtonElement>('#containers-previous')!;
  const next = document.querySelector<HTMLButtonElement>('#containers-next')!;
  const range = document.querySelector<HTMLElement>('#containers-range')!;
  const pageSize = 50;
  let page = 0;
  let data: ContainerData | null = null;
  let busy = false;
  let loading = false;
  let stateVersion = 0;
  let renderedRows: string | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let access: (ContainerIdentity & { command: string; expiresAt: number }) | null = null;
  let terminal: (ContainerIdentity & { session: { dispose: () => void } }) | null = null;
  let customImages: Image[] = [];
  let catalog = [{ id: 'node', name: 'Node 24 + TypeScript' }];
  let imageOptionsKey = '';
  const terminalHost = document.querySelector<HTMLElement>('#container-terminal')!;
  let previewsSupported = false;
  let observability: ObservabilityCapabilities = {};
  let persistence: PersistenceCapabilities = {};
  const workspaces = createWorkspacesDashboard({onUnauthenticated:()=>{dispose();onUnauthenticated();},onChanged:()=>load()});
  const observations = createContainerObservations({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });
  const previews = createContainerPreviews({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });

  const privateServices = createPrivateServices({ onUnauthenticated: () => { dispose(); onUnauthenticated(); },
    onChanged: () => { if (!disposed && data) render(); } });

  function closeTerminal(stopped = false) {
    terminal?.session.dispose();
    terminal = null;
    terminalHost.hidden = !stopped;
    if (stopped) {
      terminalHost.querySelector<HTMLElement>('[role="status"]')!.textContent = 'Container stopped.';
      terminalHost.querySelector<HTMLElement>('.terminal-output')!.replaceChildren();
      terminalHost.querySelector<HTMLElement>('.terminal-output')!.hidden = true;
      terminalHost.querySelector<HTMLButtonElement>('button')!.onclick = () => { terminalHost.hidden = true; refresh.focus(); };
    }
  }

  async function connectTerminal(container: Container) {
    if (busy || disposed || !data || container.status !== 'running') return;
    busy = true;
    stateVersion++;
    clearTimeout(timer);
    controls();
    let openContainerTerminal;
    try {
      ({ openContainerTerminal } = await import('./container-terminal.ts'));
    } catch {
      error.textContent = 'Could not load the terminal. Try again.';
      error.hidden = false;
      return;
    } finally {
      busy = false;
      controls();
      schedule();
    }
    if (disposed || !data?.containers.some(c => c.id === container.id && c.createdAt === container.createdAt)) return;
    closeTerminal();
    terminalHost.querySelector<HTMLButtonElement>('button')!.onclick = null;
    terminalHost.querySelector<HTMLElement>('.terminal-output')!.hidden = false;
    terminalHost.hidden = false;
    terminalHost.querySelector<HTMLElement>('[role="status"]')!.textContent = 'Connecting…';
    terminal = { id: container.id, createdAt: container.createdAt, session: openContainerTerminal(terminalHost, {
      id: container.id, createdAt: container.createdAt,
      onClose: () => { terminal = null; list.querySelector<HTMLButtonElement>('button')?.focus(); },
    }) };
  }

  function controls() {
    create.disabled = busy || disposed || !canCreateContainer(data, selectedSize()) || (!catalog.length && !customImages.length);
    openLaunch.disabled = busy || disposed || !data;
    refresh.disabled = busy || disposed;
    imageSelect.disabled = busy || disposed;
    containerName.disabled = busy || disposed;
    sizePicker.disabled = busy || disposed || !data?.sizes?.length;
    if (sizeRate) {
      const size = data?.sizes?.find(item => item.id === selectedSize());
      sizeRate.textContent = size ? `${size.name} uses ${size.computeUnits} compute ${size.computeUnits === 1 ? 'unit' : 'units'} per hour.` : '';
      if (data?.active && !canCreateContainer(data, selectedSize())) {
        sizeRate.textContent = data.containers.length >= data.limits.maxContainers
          ? 'All container slots are in use. Stop a container to free a slot.'
          : data.usage.starts >= data.limits.maxStartsPerMonth ? 'Your monthly start allowance is used up.'
          : (data.usage.availableComputeUnitHours ?? 1) <= 0 ? 'Your compute allowance is used or reserved by running containers.'
          : 'This size exceeds your available concurrent compute. Choose a smaller size or stop a container.';
      }
    }
    list.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = busy || !data || disposed || (button.dataset.requiresRunning === 'true' && button.dataset.running !== 'true');
    });
    previous.disabled = busy || !data || disposed || page === 0;
    next.disabled = busy || !data || disposed || (page + 1) * pageSize >= data.containers.length;
    previews.setBusy(busy || !data || disposed);
    privateServices.setBusy(busy || !data || disposed);
    workspaces.setBusy(busy || !data || disposed);
  }

  async function request(method: string, id?: string, createdAt?: string) {
    const image = { name: containerName.value.trim(), ...imageSelection(imageSelect.value), ...(data?.sizes?.length ? { size: selectedSize() } : {}) };
    const url = new URL(`${API_ORIGIN}/containers`);
    if (id) url.searchParams.set('id', id);
    if (createdAt) url.searchParams.set('createdAt', createdAt);
    const response = await fetch(url, {
      method, credentials: 'include',
      headers: { accept: 'application/json', ...(method === 'POST' && image ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' && image ? { body: JSON.stringify(image) } : {}),
    });
    if (response.status === 401) {
      dispose();
      onUnauthenticated();
      throw new Error('not_authenticated');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = response.status === 409 ? 'container_limit_exceeded'
        : response.status === 429 ? 'container_quota_exceeded' : 'containers_unavailable';
      throw new Error(result?.error || fallback);
    }
    if (!Array.isArray(result?.containers)
      || !Number.isInteger(result.usage?.starts)
      || !Number.isInteger(result.limits?.maxStartsPerMonth)) {
      throw new Error('containers_unavailable');
    }
    return result;
  }

  function render() {
    if (!data) return;
    previews.sync(data.containers, previewsSupported);
    privateServices.sync(data.containers);
    document.querySelector<HTMLElement>('#containers-title')!.firstChild!.textContent = privateServices.visible ? 'Private Services & containers ' : 'Containers ';
    if (Array.isArray(data.sizes)) {
      const key = JSON.stringify(data.sizes);
      if (key !== sizeOptionsKey) {
        const selected = selectedSize();
        const selection = data.sizes.some(size => size.id === selected) ? selected : data.sizes[0]?.id;
        sizeOptions.replaceChildren(...data.sizes.map(size => {
          const option = document.createElement('label');
          option.className = 'machine-option';
          const radio = document.createElement('input');
          radio.type = 'radio'; radio.name = 'machine-size'; radio.value = size.id;
          radio.checked = size.id === selection;
          const title = document.createElement('span'); title.className = 'machine-name'; title.textContent = size.name;
          const memory = document.createElement('span'); memory.className = 'machine-memory';
          memory.textContent = `${size.memoryMiB < 1024 ? `${size.memoryMiB} MiB` : `${size.memoryMiB / 1024} GiB`} RAM`;
          const specs = document.createElement('span'); specs.className = 'machine-specs';
          specs.textContent = `${size.cpuVcpu} vCPU · ${size.diskGB} GB disk`;
          const rate = document.createElement('span'); rate.className = 'machine-rate';
          rate.textContent = `${size.computeUnits} CU/hr`;
          const accessibleRate = document.createElement('span'); accessibleRate.className = 'visually-hidden';
          accessibleRate.textContent = `${size.computeUnits} compute ${size.computeUnits === 1 ? 'unit' : 'units'} per hour`;
          rate.setAttribute('aria-hidden', 'true');
          option.append(radio, title, memory, specs, rate, accessibleRate);
          return option;
        }));
        sizeOptionsKey = key;
      }
    }
    if (Array.isArray(data.imageCatalog)) {
      catalog = data.imageCatalog.filter(image => typeof image.id === 'string' && typeof image.name === 'string');
      renderImages();
    }
    if (terminal && !data.containers.some(c => c.id === terminal?.id && c.createdAt === terminal?.createdAt)) closeTerminal(true);
    list.hidden = data.containers.length === 0 && privateServices.networks.length === 0;
    page = Math.min(page, Math.max(0, Math.ceil(data.containers.length / pageSize) - 1));
    pagination.hidden = data.containers.length <= pageSize;
    range.textContent = `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, data.containers.length)} of ${data.containers.length}`;
    const remaining = Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts);
    usage.hidden = !data.active;
    usageContainers.textContent = `${data.containers.length} / ${data.limits.maxContainers.toLocaleString()}`;
    usageConcurrency.textContent = data.limits.maxConcurrentComputeUnits !== undefined
      ? `${data.usage.concurrentComputeUnits ?? 0} / ${data.limits.maxConcurrentComputeUnits.toLocaleString()} concurrent compute units` : 'Active container slots';
    usageCompute.textContent = data.usage.availableComputeUnitHours !== undefined
      ? `${data.usage.availableComputeUnitHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}${data.limits.maxComputeUnitHours !== undefined ? ` / ${data.limits.maxComputeUnitHours.toLocaleString()}` : ''}` : '—';
    usageComputeDetail.textContent = data.usage.availableComputeUnitHours !== undefined
      ? `${data.usage.computeUnitHours.toFixed(1)} used · ${data.usage.reservedComputeUnitHours.toFixed(1)} reserved` : 'Compute usage unavailable';
    usageStarts.textContent = `${remaining.toLocaleString()} / ${data.limits.maxStartsPerMonth.toLocaleString()}`;
    usageStartsDetail.textContent = `${data.usage.starts.toLocaleString()} starts used · Resets monthly (UTC)`;
    status.textContent = '';
    empty.hidden = data.containers.length !== 0 || privateServices.networks.length !== 0;
    count.textContent = String(data.containers.length + privateServices.networks.length);
    count.hidden = false;
    const hours = Math.round(data.limits.maxSessionMs / 3600000);
    const idleMinutes = Math.round(data.limits.idleTimeoutMs / 60000);
    document.querySelector<HTMLElement>('#container-limits')!.textContent = data.active
      ? `Sessions last up to ${hours} ${hours === 1 ? 'hour' : 'hours'} · Auto-stop after ${idleMinutes} idle minutes.`
      : 'An active subscription is required to create containers.';
    if (access && (!data.containers.some(c => c.id === access?.id && c.createdAt === access?.createdAt) || access.expiresAt <= Date.now())) access = null;
    const rows = data.containers.slice(page * pageSize, (page + 1) * pageSize);
    const rowVersion = JSON.stringify({ page, rows, access, previewsSupported, observability, persistence, privateServices: privateServices.stateKey, today: new Date().toDateString() });
    if (rowVersion === renderedRows) { controls(); return; }
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedRow = focused?.closest<HTMLElement>('[data-container-id]');
    const focus = focusedRow ? { id: focusedRow.dataset.containerId, createdAt: focusedRow.dataset.createdAt,
      action: focused!.dataset.action, start: (focused as HTMLInputElement).selectionStart, end: (focused as HTMLInputElement).selectionEnd } : null;
    list.replaceChildren();
    const groups = privateServices.buildGroups(list, rows);
    for (const container of rows) {
      const row = document.createElement('tr');
      row.className = 'machine-table-row';
      const member = privateServices.membership(container);
      const body = groups.get(member?.network ?? '');
      if (!body) continue;
      row.dataset.containerId = container.id;
      row.dataset.createdAt = container.createdAt;
      const details = document.createElement('td');
      details.className = 'machine-column-0';
      details.dataset.label = 'Name';
      details.classList.add('container-details');
      const heading = document.createElement('div');
      heading.className = 'container-row-heading';
      const name = document.createElement('strong');
      name.textContent = container.name || member?.member.name || container.id;
      const state = document.createElement('p');
      state.className = 'dashboard-status';
      const expiry = new Date(container.expiresAt);
      const expiryOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit',
        ...(expiry.toDateString() !== new Date().toDateString() ? { month: 'short', day: 'numeric' } : {}) };
      const running = container.status === 'running';
      const badge = document.createElement('span');
      badge.className = 'container-state';
      badge.dataset.state = container.status;
      badge.textContent = running ? 'Running' : container.status === 'starting' ? 'Starting…' : container.status === 'stopping' ? 'Stopping…' : container.status;
      heading.append(name);
      const identity = document.createElement('code');
      identity.textContent = container.id.slice(0, 8); identity.title = container.id;
      state.append(identity);
      if (container.size) {
        const size = document.createElement('span');
        size.textContent = data.sizes?.find(item => item.id === container.size)?.name ?? container.size;
        state.append(size);
      }
      const expires = document.createElement('span');
      expires.textContent = `Stops by ${expiry.toLocaleString([], expiryOptions)}`;
      state.append(expires);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'dashboard-retry button-danger';
      stop.textContent = 'Stop';
      stop.dataset.action = 'stop';
      stop.setAttribute('aria-label', `Stop ${container.name || container.id}`);
      stop.addEventListener('click', () => {
        if (window.confirm(`Stop ${container.name || container.id}? Its files will be lost.`)) mutate('DELETE', container.id, container.createdAt);
      });
      details.append(heading, state);
      const actions = document.createElement('div');
      actions.className = 'container-actions';
      const connect = document.createElement('button');
      connect.type = 'button';
      connect.className = 'dashboard-retry';
      connect.textContent = 'SSH';
      connect.dataset.action = 'ssh';
      connect.dataset.requiresRunning = 'true';
      connect.dataset.running = String(running);
      connect.addEventListener('click', () => connectSSH(container));
      const shell = document.createElement('button');
      shell.type = 'button';
      shell.className = 'dashboard-retry container-terminal-action';
      shell.textContent = 'Open terminal';
      shell.dataset.action = 'terminal';
      shell.dataset.requiresRunning = 'true';
      shell.dataset.running = String(running);
      shell.addEventListener('click', () => connectTerminal(container));
      const menu = document.createElement('details'); menu.className = 'container-action-menu';
      const menuToggle = document.createElement('summary'); menuToggle.textContent = '•••';
      menuToggle.setAttribute('aria-label', `Actions for ${container.name || member?.member.name || container.id}`);
      const menuActions = document.createElement('div'); menuActions.className = 'container-menu-items';
      menuActions.append(connect, stop); menu.append(menuToggle, menuActions); actions.append(shell, menu);
      const cell = (text: string, index: number, label: string) => {
        const td = document.createElement('td'); td.className = `machine-column-${index}`; td.dataset.label = label; td.textContent = text; return td;
      };
      const stateCell = cell('', 1, 'Status'); stateCell.append(badge);
      const imageCell = cell(container.imageName || '—', 2, 'Image');
      const serviceCell = cell(member ? member.member.port === undefined ? 'Caller only' : `http://${member.member.name}.internal` : '—', 3, 'Private service');
      if (member?.member.port !== undefined) {
        const port = document.createElement('span'); port.className = 'private-port'; port.textContent = `Port ${member.member.port}`; serviceCell.append(port);
      }
      const started = cell(new Date(container.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), 4, 'Last started');
      const actionsCell = cell('', 5, 'Actions'); actionsCell.append(actions);
      row.append(details, stateCell, imageCell, serviceCell, started, actionsCell); body.append(row);
      const expansion = document.createElement('tr'); expansion.className = 'machine-preview-row';
      const expansionCell = document.createElement('td'); expansionCell.colSpan = 6; expansion.append(expansionCell);
      previews.attach(expansionCell, menuActions, container);
      observations.attach(menuActions, container);
      workspaces.attach(menuActions,container);
      privateServices.attach(menuActions, container);
      menuActions.append(stop);
      if (expansionCell.children.length) body.append(expansion);
      if (access?.id === container.id) {
        const connectionRow = document.createElement('tr'); connectionRow.className = 'machine-ssh-row';
        const connection = document.createElement('td'); connection.colSpan = 6; connectionRow.append(connection);
        connection.className = 'container-ssh';
        connection.dataset.containerId = container.id;
        connection.dataset.createdAt = container.createdAt;
        const label = document.createElement('label');
        label.textContent = 'SSH command';
        const command = document.createElement('textarea');
        command.readOnly = true;
        command.rows = 3;
        command.value = access.command;
        command.dataset.action = 'ssh-command';
        label.append(command);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'dashboard-retry';
        copy.textContent = 'Copy command';
        copy.dataset.action = 'copy';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(command.value); copy.textContent = 'Copied'; }
          catch { command.focus(); command.select(); }
        });
        const note = document.createElement('p');
        note.className = 'dashboard-status';
        note.textContent = `Requires cloudflared on your computer. Access expires at ${new Date(access.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Keep this command private.`;
        const install = document.createElement('a');
        install.href = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
        install.textContent = 'Install cloudflared';
        install.target = '_blank';
        install.rel = 'noopener noreferrer';
        connection.append(label, copy, note, install);
        body.append(connectionRow);
      }
    }
    renderedRows = rowVersion;
    controls();
    if (focus) {
      const target = [...list.querySelectorAll<HTMLElement>('[data-action]')].find(element => {
        const row = element.closest<HTMLElement>('[data-container-id]');
        return element.dataset.action === focus.action && row?.dataset.containerId === focus.id && row?.dataset.createdAt === focus.createdAt;
      });
      if (target && !(target as HTMLButtonElement).disabled) {
        target.focus({ preventScroll: true });
        if (focus.start !== null && Number.isInteger(focus.start)) (target as HTMLInputElement).setSelectionRange(focus.start, focus.end);
      }
    }
  }

  async function connectSSH(container: Container) {
    if (busy || disposed || !data || container.status !== 'running') return;
    busy = true;
    stateVersion++;
    clearTimeout(timer);
    error.hidden = true;
    controls();
    try {
      const response = await fetch(`${API_ORIGIN}/containers/ssh`, {
        method: 'POST', credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ id: container.id, createdAt: container.createdAt }),
      });
      if (response.status === 401) { dispose(); onUnauthenticated(); return; }
      const result = await response.json();
      if (!response.ok || typeof result.command !== 'string' || !Number.isFinite(result.expiresAt)) {
        throw new Error(response.status === 429 ? 'limit' : 'unavailable');
      }
      if (disposed) return;
      access = { ...result, id: container.id, createdAt: container.createdAt };
      render();
      list.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
      if (disposed) return;
      error.textContent = cause.message === 'limit'
        ? 'You have too many active SSH commands. Wait for one to expire.'
        : 'Could not prepare SSH access. Refresh containers and try again.';
      error.hidden = false;
    } finally {
      busy = false;
      controls();
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => {
      if (document.visibilityState === 'visible' && !busy && !loading) load(true);
      else schedule();
    }, 15000);
  }

  async function load(background = false) {
    if (busy || disposed || loading) return;
    const version = stateVersion;
    loading = true;
    if (!background) busy = true;
    if (!background) error.hidden = true;
    controls();
    try {
      const [result, capabilities] = await Promise.all([request('GET'),
        fetch(`${API_ORIGIN}/capabilities`, { credentials: 'omit', redirect: 'error',
          headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
          .then(response => response.ok ? response.json() : null).catch(() => null)]);
      if (disposed || version !== stateVersion) return;
      previewsSupported = capabilities?.previews?.supported === true;
      observability = capabilities?.observability ?? {};
      persistence = capabilities?.persistence ?? {};
      workspaces.configure(persistence);
      observations.configure(observability);
      data = result;
      privateServices.configure(capabilities?.networking?.privateServices === true);
      render();
      error.hidden = true;
    } catch {
      if (disposed || version !== stateVersion) return;
      // Disable creation while the current state is unknown, including when a
      // background refresh fails after the last known container stopped.
      data = null;
      list.hidden = true;
      empty.hidden = true;
      count.hidden = true;
      usage.hidden = true;
      pagination.hidden = true;
      status.textContent = 'Container status is unavailable.';
      error.textContent = 'Could not load containers. Refresh to try again.';
      error.hidden = false;
    } finally {
      loading = false;
      if (!background) busy = false;
      controls();
      if (version === stateVersion) schedule();
    }
  }

  async function mutate(method: string, id?: string, createdAt?: string) {
    if (busy || disposed || !data || (method === 'POST' && create.disabled)) return;
    if (method === 'POST') {
      containerName.setCustomValidity(containerName.value.trim() ? '' : 'Enter a container name.');
      if (!launchForm.reportValidity()) return;
    }
    if (method === 'DELETE' && terminal?.id === id && terminal?.createdAt === createdAt) closeTerminal(true);
    busy = true;
    stateVersion++;
    clearTimeout(timer);
    error.hidden = true;
    launchError.hidden = true;
    let mutationError = method === 'POST' ? launchError : error;
    create.textContent = method === 'POST' ? 'Creating…' : 'Create container';
    launchStatus.textContent = method === 'POST' ? 'Starting your container…' : '';
    status.textContent = method === 'POST' ? 'Starting your container…' : 'Stopping your container…';
    controls();
    try {
      const result = await request(method, id, createdAt);
      if (disposed) return;
      data = result;
      if (method === 'POST') trackMachineStart(selectedSize());
      render();
      if (method === 'POST') { containerName.value = ''; launch.close(); }
      if (method === 'DELETE') refresh.focus();
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
      if (disposed) return;
      if (!launch.open) mutationError = error;
      const message = cause.message === 'invalid_container_name'
        ? 'Enter a container name of up to 80 characters without control characters.'
        : cause.message === 'compute_allowance_exhausted'
        ? 'Your available compute allowance is reserved or used. Stop a session to release unused runtime, or wait for the next UTC month.'
        : cause.message === 'compute_capacity_exceeded'
        ? 'This size exceeds your available concurrent compute units. Choose a smaller size or stop a container.'
        : cause.message === 'invalid_size'
        ? 'This size is unavailable. Refresh and choose another size.'
        : cause.message === 'container_quota_exceeded'
        ? `You’ve used all ${data?.limits?.maxStartsPerMonth ?? 'available'} container starts for this month. Your allowance resets next month (UTC).`
        : ['image_not_ready', 'image_not_available'].includes(cause.message)
          ? 'This image is not ready to launch. Refresh images and try again.'
        : cause.message === 'image_not_found'
          ? 'This image is no longer available. Choose another image.'
        : cause.message === 'container_limit_exceeded'
          ? `Your plan allows ${data?.limits?.maxContainers ?? 'the current maximum'} running containers. Stop one or change plans to create another.`
          : cause.message === 'subscription_required'
            ? 'Choose a plan to create containers.'
            : cause.message === 'container_not_running'
              ? 'This container has already stopped or been replaced. Refresh to see the current containers.'
            : cause.message === 'billing_unavailable'
              ? 'Billing is temporarily unavailable. Try again shortly.'
          : `Could not ${method === 'POST' ? 'create' : 'stop'} your container. Refresh to check its status.`;
      mutationError.replaceChildren();
      mutationError.append(document.createTextNode(message));
      if (cause.message === 'subscription_required') {
        const link = document.createElement('a');
        link.href = '/pricing/';
        link.textContent = ' View plans';
        mutationError.append(link);
      }
      mutationError.hidden = false;
      data = null;
      usage.hidden = true;
      count.hidden = true;
      status.textContent = 'Refresh containers to check the current state.';
    } finally {
      busy = false;
      launchStatus.textContent = '';
      create.textContent = 'Create container';
      controls();
      // Leave mutation errors visible until the user reconciles the state.
      if (mutationError.hidden) schedule();
    }
  }

  function dispose() {
    privateServices.dispose();
    workspaces.dispose();
    observations.dispose();
    previews.dispose();
    closeTerminal();
    launch.close();
    disposed = true;
    clearTimeout(timer);
    data = null;
    access = null;
    list.replaceChildren();
    pagination.hidden = true;
    controls();
  }

  list.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = (event.target as HTMLElement).closest<HTMLDetailsElement>('.container-action-menu');
    if (menu) { menu.open = false; menu.querySelector<HTMLElement>('summary')!.focus(); }
  });
  list.addEventListener('click', event => {
    const menu = (event.target as HTMLElement).closest<HTMLDetailsElement>('.container-action-menu');
    list.querySelectorAll<HTMLDetailsElement>('.container-action-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
  });
  sizePicker.addEventListener('change', controls);
  openLaunch.addEventListener('click', () => {
    launchError.hidden = true;
    launch.showModal();
    containerName.focus();
  });
  document.querySelector<HTMLButtonElement>('#container-launch-close')!.addEventListener('click', () => launch.close());
  launch.addEventListener('close', () => {
    if (!launchError.hidden) {
      error.replaceChildren(...[...launchError.childNodes].map(node => node.cloneNode(true)));
      error.hidden = false;
    }
  });
  containerName.addEventListener('input', () => containerName.setCustomValidity(''));
  launchForm.addEventListener('submit', event => { event.preventDefault(); mutate('POST'); });
  refresh.addEventListener('click', () => load());
  function renderImages() {
    const key = JSON.stringify([catalog, customImages]);
    if (key === imageOptionsKey) return;
    imageOptionsKey = key;
    const selected = imageSelect.value;
    imageSelect.replaceChildren();
    for (const image of catalog) imageSelect.add(new Option(image.name, image.id === 'node' ? '' : `catalog:${image.id}`));
    if (customImages.length) {
      const group = document.createElement('optgroup');
      group.label = 'Your custom images';
      for (const image of customImages) group.append(new Option(image.name, image.id));
      imageSelect.append(group);
    }
    if (!imageSelect.options.length) {
      const option = new Option('No images available', '');
      option.disabled = true;
      imageSelect.add(option);
    }
    imageSelect.value = Array.from(imageSelect.options).some(option => option.value === selected) ? selected : imageSelect.options[0].value;
  }
  function setImages(images: Image[]) { customImages = images; renderImages(); controls(); }
  function selectImage(id: string) {
    imageSelect.value = id;
    launchError.hidden = true;
    launch.showModal();
    containerName.focus();
  }
  previous.addEventListener('click', () => { if (!previous.disabled) { page--; render(); previous.focus(); } });
  next.addEventListener('click', () => { if (!next.disabled) { page++; render(); next.focus(); } });
  return { load, dispose, setImages, selectImage };
}
