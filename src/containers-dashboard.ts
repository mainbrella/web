import { containerLifecycle, hourlyCost, monthlyCost, type Lifecycle } from './dashboard-view.ts';
import { trackMachineStart } from './platform.ts';
import type { Container, ContainerData, ContainerIdentity, ContainerLimits, MachineSize, Image, ObservabilityCapabilities, PersistenceCapabilities } from './container-types.ts';
import { API_ORIGIN } from './platform.ts';
import { createContainerPreviews } from './container-previews.ts';
import { createContainerObservations } from './container-observations.ts';
import { createWorkspacesDashboard } from './workspaces-dashboard.ts';
import { createPrivateServices } from './private-services.ts';
import { formatBalance } from './platform.ts';
import { canResumeContainer, createLifecycleClient, lifecycleError, type ContainerAction } from './container-lifecycle.ts';
import { createSandboxSecurity } from './sandbox-security.ts';
import { createContainerStartup } from './container-startup.ts';

type CreationState = {
  active: boolean; containers: unknown[];
  limits: Pick<ContainerLimits, 'maxContainers' | 'maxStartsPerMonth' | 'maxConcurrentComputeUnits'>;
  usage: Pick<ContainerData['usage'], 'starts' | 'availableComputeUnitHours' | 'concurrentComputeUnits'>;
  sizes?: Pick<MachineSize, 'id' | 'computeUnits'>[];
  billing?: Pick<NonNullable<ContainerData['billing']>, 'balanceCents'> | null;
};

export function occupiedContainerSlots(containers: unknown[]) {
  return containers.filter(container => !(container && typeof container === 'object'
    && 'status' in container && container.status === 'stopped' && 'workspaceId' in container && container.workspaceId)).length;
}

export function canCreateContainer(data: CreationState | null, size = 'lite') {
  return Boolean(data && (!data.active || (
    occupiedContainerSlots(data.containers) < data.limits.maxContainers
      && data.usage.starts < data.limits.maxStartsPerMonth
      // Wallet and cap figures are rounded snapshots. The server reserves exact
      // runtime and can have newer funding, so don't block prepaid attempts here.
      && (typeof data.billing?.balanceCents === 'number' || data.usage.availableComputeUnitHours === undefined || data.usage.availableComputeUnitHours > 0)
      && (data.limits.maxConcurrentComputeUnits === undefined || (data.usage.concurrentComputeUnits ?? 0) + (data.sizes?.find(item => item.id === size)?.computeUnits ?? 1) <= data.limits.maxConcurrentComputeUnits)
  )));
}

export function productionLaunchFunding(data: ContainerData, size: Pick<MachineSize, 'computeUnits'>) {
  const existingHourlyCents = data.billing?.productionHourlyCents ?? data.containers
    .filter(container => containerLifecycle(container) === 'production')
    .reduce((sum, container) => sum + (data.sizes?.find(item => item.id === container.size)?.computeUnits ?? 1) * 2, 0);
  return Math.ceil((existingHourlyCents + size.computeUnits * 2) * (data.billing?.minimumProductionRuntimeMs ?? 86_400_000) / 3_600_000);
}

export function imageSelection(value: string) {
  return value.startsWith('catalog:') ? { catalogId: value.slice(8) }
    : value ? { imageId: value } : null;
}

export function createContainersDashboard({ onUnauthenticated, getAccountId, lifecycle = 'ad_hoc', overview = false, onData, onLoadError }: { onUnauthenticated: () => void; getAccountId: () => string | null; lifecycle?: Lifecycle; overview?: boolean; onData?: (data: ContainerData) => void; onLoadError?: () => void }) {
  const production = lifecycle === 'production';
  const startupCommand = document.querySelector<HTMLInputElement>('#container-startup-command')!;
  document.querySelector<HTMLElement>('#production-launch-settings')!.hidden = !production;
  document.querySelector<HTMLElement>('#launch-title')!.textContent = production ? 'New production container' : 'New container';
  document.querySelector<HTMLElement>('#dashboard-resources')!.hidden = overview;
  document.querySelector<HTMLElement>('#workspaces-tab')!.hidden = production;
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
  const imageTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-image-tab]')];
  const stockPanel = document.querySelector<HTMLElement>('#stock-images-panel')!;
  const customPanel = document.querySelector<HTMLElement>('#custom-images-panel')!;
  const customLaunch = document.querySelector<HTMLElement>('#custom-image-launch')!;
  let imageTab: 'stock' | 'custom' = 'stock';
  const refresh = document.querySelector<HTMLButtonElement>('#containers-refresh')!;
  const list = document.querySelector<HTMLElement>('#container-list')!;
  const status = document.querySelector<HTMLElement>('#containers-status')!;
  const empty = document.querySelector<HTMLElement>('#containers-empty')!;
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-resource-tab]')].filter(button => !button.hidden);
  const panel = document.querySelector<HTMLElement>('#resources-panel')!;
  const filters = document.querySelector<HTMLElement>('#container-filters')!;
  const search = document.querySelector<HTMLInputElement>('#container-search')!;
  let activeTab: 'containers' | 'networks' | 'workspaces' | 'secrets' = 'containers';
  const filteredContainers = () => (data?.containers ?? []).filter(container =>
    containerLifecycle(container) === lifecycle && !privateServices.membership(container) && `${container.name ?? ''} ${container.id}`.toLowerCase().includes(search.value.trim().toLowerCase()));
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
  const lifecycleRequest = createLifecycleClient({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });
  const lifecycleKeys = new Map<string, string>();
  const pendingForkNames = new Map<string, string>();
  const forkIdentity = (container: Container) => JSON.stringify([container.id, container.createdAt]);
  const forkDialog = document.querySelector<HTMLDialogElement>('#container-fork-dialog')!;
  const forkForm = forkDialog.querySelector<HTMLFormElement>('form')!;
  const forkName = forkDialog.querySelector<HTMLInputElement>('input')!;
  const forkError = forkDialog.querySelector<HTMLElement>('[role="alert"]')!;
  const forkStatus = forkDialog.querySelector<HTMLElement>('[role="status"]')!;
  let forkSource: Container | null = null;
  const workspaces = createWorkspacesDashboard({getAccountId,onUnauthenticated:()=>{dispose();onUnauthenticated();},onChanged:()=>load()});
  const startup = createContainerStartup({ onUnauthenticated: () => { dispose(); onUnauthenticated(); }, onChanged: () => load() });
  const observations = createContainerObservations({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });
  const previews = createContainerPreviews({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });
  const security = createSandboxSecurity({ onUnauthenticated: () => { dispose(); onUnauthenticated(); } });

  const privateServices = createPrivateServices({ onUnauthenticated: () => { dispose(); onUnauthenticated(); },
    onChanged: () => { if (!disposed && data) render(); }, lifecycle });

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
    create.disabled = busy || disposed || !canCreateContainer(data, selectedSize()) || !(imageTab === 'stock' ? catalog.length : customImages.length);
    openLaunch.disabled = busy || disposed || !data;
    startupCommand.disabled = busy || disposed;
    startupCommand.required = production;
    const billingLink = document.querySelector<HTMLAnchorElement>('#production-billing-link')!;
    billingLink.href = '/pricing/';
    billingLink.hidden = !production;
    refresh.disabled = busy || disposed;
    imageSelect.disabled = busy || disposed;
    containerName.disabled = busy || disposed;
    sizePicker.disabled = busy || disposed || !data?.sizes?.length;
    if (sizeRate) {
      const size = data?.sizes?.find(item => item.id === selectedSize());
      sizeRate.textContent = size ? production ? `${formatBalance(hourlyCost(size) * 100)}/hour · about ${formatBalance(monthlyCost(size) * 100)}/30-day month. Launch requires at least ${formatBalance(productionLaunchFunding(data!, size))} of funding for 24 hours across the resulting production fleet. Your remaining monthly cap must also cover that runtime.` : `${size.name} costs ${formatBalance(hourlyCost(size) * 100)}/hour.` : '';
      if (data?.active && !canCreateContainer(data, selectedSize())) {
        sizeRate.textContent = occupiedContainerSlots(data.containers) >= data.limits.maxContainers
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
    next.disabled = busy || !data || disposed || (page + 1) * pageSize >= filteredContainers().length;
    previews.setBusy(busy || !data || disposed);
    privateServices.setBusy(busy || !data || disposed);
    workspaces.setBusy(busy || !data || disposed);
    startup.setBusy(busy || !data || disposed);
    security.setBusy(busy || !data || disposed);
    forkDialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button[type="submit"]').forEach(control => { control.disabled = busy || disposed; });
    forkName.readOnly = Boolean(forkSource && pendingForkNames.has(forkIdentity(forkSource)));
  }

  async function request(method: string, id?: string, createdAt?: string) {
    const image = method === 'POST' ? { ...(production ? { lifecycle, startupCommand: startupCommand.value.trim() } : {}), name: containerName.value.trim(), ...imageSelection(imageSelect.value), ...(data?.sizes?.length ? { size: selectedSize() } : {}), ...security.creationSettings() } : undefined;
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
    onData?.(data);
    previews.sync(data.containers, previewsSupported);
    privateServices.sync(data.containers);
    startup.sync(data.containers);

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
          rate.textContent = data?.billing ? `$${(size.computeUnits * 0.02).toFixed(2)}/hr` : `${size.computeUnits} CU/hr`;
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
    const filtered = filteredContainers();
    list.hidden = false;
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    pagination.hidden = activeTab !== 'containers' || filtered.length <= pageSize;
    range.textContent = `${filtered.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length}`;
    const remaining = Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts);
    usage.hidden = (!data.active && !data.billing) || !overview;
    usageContainers.textContent = `${occupiedContainerSlots(data.containers)} / ${data.limits.maxContainers.toLocaleString()}`;
    usageConcurrency.textContent = data.limits.maxConcurrentComputeUnits !== undefined
      ? `${data.usage.concurrentComputeUnits ?? 0} / ${data.limits.maxConcurrentComputeUnits.toLocaleString()} concurrent compute units` : 'Active container slots';
    document.querySelector<HTMLElement>('#usage-compute-label')!.textContent = data.billing ? 'Compute used / monthly cap' : 'Compute-unit hours available';
    usageCompute.textContent = data.billing ? `$${(data.billing.estimatedCents / 100).toFixed(2)} / $${(data.billing.spendLimitCents / 100).toFixed(2)}` : data.usage.availableComputeUnitHours !== undefined
      ? `${data.usage.availableComputeUnitHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}${data.limits.maxComputeUnitHours != null ? ` / ${data.limits.maxComputeUnitHours.toLocaleString()}` : ''}` : '—';
    usageComputeDetail.textContent = data.billing ? typeof data.billing.availableBalanceCents === 'number'
      ? `${formatBalance(data.billing.availableBalanceCents)} available funding · ${formatBalance(data.billing.reservedBalanceCents ?? 0)} reserved`
      : `${data.billing.computeUnitHours.toFixed(1)} unit-hours · Before taxes` : data.usage.availableComputeUnitHours !== undefined
      ? `${data.usage.computeUnitHours.toFixed(1)} used · ${data.usage.reservedComputeUnitHours.toFixed(1)} reserved` : 'Compute usage unavailable';
    usageStarts.textContent = `${remaining.toLocaleString()} / ${data.limits.maxStartsPerMonth.toLocaleString()}`;
    usageStartsDetail.textContent = `${data.usage.starts.toLocaleString()} starts used · Resets monthly (UTC)`;
    status.textContent = '';
    empty.hidden = activeTab !== 'containers' || filtered.length !== 0;
    empty.textContent = search.value.trim() ? 'No containers match your search.' : production ? 'You haven’t created any production containers.' : 'You have no standalone containers.';
    const hours = Math.round(data.limits.maxSessionMs / 3600000);
    const idleMinutes = Math.round(data.limits.idleTimeoutMs / 60000);
    document.querySelector<HTMLElement>('#container-limits')!.textContent = data.active
      ? production ? `No session or idle shutdown. Stops when funded runtime or your monthly spending cap runs out. Current cap: ${formatBalance(data.billing?.spendLimitCents ?? 500)}.` : `Sessions last up to ${hours} ${hours === 1 ? 'hour' : 'hours'} · Auto-stop after ${idleMinutes} idle minutes.`
      : 'Add prepaid balance to fund container runtime. Your monthly spending cap also applies.';
    if (access && (!data.containers.some(c => c.id === access?.id && c.createdAt === access?.createdAt) || access.expiresAt <= Date.now())) access = null;
    const rows = activeTab === 'networks' ? data.containers.filter(container => containerLifecycle(container) === lifecycle) : filtered.slice(page * pageSize, (page + 1) * pageSize);
    const rowVersion = JSON.stringify({ activeTab, page, rows, access, previewsSupported, observability, persistence, privateServices: privateServices.stateKey, today: new Date().toDateString() });
    if (rowVersion === renderedRows) { controls(); return; }
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedRow = focused?.closest<HTMLElement>('[data-container-id]');
    const focus = focusedRow ? { id: focusedRow.dataset.containerId, createdAt: focusedRow.dataset.createdAt,
      action: focused!.dataset.action, start: (focused as HTMLInputElement).selectionStart, end: (focused as HTMLInputElement).selectionEnd } : null;
    list.replaceChildren();
    privateServices.buildGroups(list, rows, activeTab === 'networks' ? 'networks' : 'containers', (body, members) => {
      for (const container of members) {
        const row = document.createElement('tr');
        row.className = 'machine-table-row';
        const member = privateServices.membership(container);
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
        if (container.size) {
          const size = document.createElement('span');
          size.textContent = data?.sizes?.find(item => item.id === container.size)?.name ?? container.size;
          state.append(size);
        }
        const expires = document.createElement('span');
        expires.textContent = container.status === 'stopped' && container.workspaceId
          ? (container.persistenceExpiresAt ?? 0) > Date.now() ? `Files saved until ${new Date(container.persistenceExpiresAt!).toLocaleDateString()}` : 'Saved filesystem expired'
          : container.lifecycle === 'production' ? container.status === 'stopped' ? container.stopReason === 'spend_limit_reached' ? 'Funding or spending cap reached' : ['subscription_required', 'insufficient_balance', 'prepaid_balance_required'].includes(container.stopReason ?? '') ? 'Add prepaid balance' : 'Recovery pending' : 'Runs while funded' : `Stops by ${expiry.toLocaleString([], expiryOptions)}`;
        state.append(expires);
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'dashboard-retry button-danger';
        stop.textContent = 'Delete';
        stop.dataset.action = 'delete';
        stop.setAttribute('aria-label', `Delete ${container.name || container.id}`);
        stop.addEventListener('click', () => {
          if (window.confirm(`Delete ${container.name || container.id}? This stops the machine and revokes access to its files and saved stop state. Separately saved workspaces remain available. Provider snapshot data may remain until retention expires.${production ? ' Automatic recovery will be disabled.' : ''}`)) mutate('DELETE', container.id, container.createdAt);
        });
        details.append(heading, state);
        if (container.launch && container.lifecycle !== 'production') {
          const launch = document.createElement('p'); launch.className = 'dashboard-status container-startup-summary';
          launch.textContent = `On resume or fork: ${container.launch.command} · HTTP ${container.launch.readiness.port}${container.launch.readiness.path || '/'}`;
          details.append(launch);
        }
        if (container.readiness) {
          const appState = document.createElement('p'); appState.className = 'dashboard-status';
          appState.textContent = container.readiness.status === 'ready' ? `Application ready · HTTP ${container.readiness.port}${container.readiness.path}`
            : container.readiness.status === 'starting' ? 'Application starting; checking HTTP readiness…'
            : 'Application did not become ready. Open the terminal to inspect or restart it.';
          details.append(appState);
          if (container.readiness.status === 'failed') {
            const logs = document.createElement('details'); logs.className = 'workspace-launch-logs';
            const summary = document.createElement('summary'); summary.textContent = 'Startup log';
            const log = document.createElement('pre'); log.tabIndex = 0;
            log.textContent = `${container.readiness.logTail ? `${container.readiness.logTail}\n\n` : ''}Full log: ${container.readiness.logPath}`;
            logs.append(summary, log); details.append(logs);
          }
        }
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
        if (canResumeContainer(container, persistence)) {
          const resume = document.createElement('button'); resume.type = 'button'; resume.className = 'dashboard-retry';
          resume.textContent = 'Resume'; resume.dataset.action = 'resume';
          resume.setAttribute('aria-label', `Resume ${container.name || container.id}`);
          resume.onclick = () => runLifecycle('resume', container);
          shell.replaceWith(resume);
        }
        if (running && persistence.filesystemAfterStop === true) {
          const suspend = document.createElement('button'); suspend.type = 'button'; suspend.className = 'dashboard-retry';
          suspend.textContent = 'Stop and save'; suspend.dataset.action = 'stop';
          suspend.setAttribute('aria-label', `Stop and save ${container.name || container.id}`);
          suspend.onclick = () => runLifecycle('stop', container);
          menuActions.append(suspend);
        }
        if (running && persistence.filesystemFork === true) {
          const fork = document.createElement('button'); fork.type = 'button'; fork.className = 'dashboard-retry';
          fork.textContent = 'Fork'; fork.dataset.action = 'fork';
          fork.setAttribute('aria-label', `Fork ${container.name || container.id}`);
          fork.onclick = () => {
            if (busy || disposed) return;
            forkSource = container; forkName.value = pendingForkNames.get(forkIdentity(container)) ?? `${container.name || 'Container'} fork`.slice(0, 80);
            forkDialog.querySelector<HTMLElement>('[data-fork-startup]')!.textContent = container.launch
              ? `After copying, runs ${container.launch.command} and checks HTTP ${container.launch.readiness.port}${container.launch.readiness.path || '/'}.`
              : 'No startup command is saved. Start the application in the fork’s terminal, or configure Startup settings before forking.';
            forkDialog.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent = pendingForkNames.has(forkIdentity(container)) ? 'Retry fork' : 'Create fork';
            controls();
            forkError.hidden = true; forkStatus.textContent = ''; forkDialog.showModal(); forkName.focus();
          };
          menuActions.append(fork);
        }
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
        startup.attach(menuActions, container);
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
      controls();
    });
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

  async function runLifecycle(action: ContainerAction, container: Container, name?: string) {
    if (busy || disposed || !data) return;
    const fingerprint = JSON.stringify([action, container.id, container.createdAt, name]);
    const key = lifecycleKeys.get(fingerprint) ?? crypto.randomUUID();
    lifecycleKeys.set(fingerprint, key);
    if (action === 'fork') pendingForkNames.set(forkIdentity(container), name ?? '');
    busy = true; stateVersion++; clearTimeout(timer); error.hidden = true; forkError.hidden = true;
    const targetError = action === 'fork' ? forkError : error;
    const targetStatus = action === 'fork' ? forkStatus : status;
    targetStatus.textContent = action === 'stop' ? 'Saving filesystem and stopping…' : action === 'resume' ? 'Restoring filesystem…' : 'Copying filesystem and starting fork…';
    controls();
    try {
      const result = await lifecycleRequest(action, container, key, name);
      if (disposed) return;
      if (action === 'stop' && terminal?.id === container.id && terminal.createdAt === container.createdAt) closeTerminal(true);
      data = result; lifecycleKeys.delete(fingerprint); if (action === 'fork') pendingForkNames.delete(forkIdentity(container)); render();
      if (action === 'fork') forkDialog.close();
      refresh.focus();
    } catch (caught) {
      if (disposed) return;
      targetStatus.textContent = '';
      targetError.textContent = lifecycleError(caught instanceof Error ? caught.message : ''); targetError.hidden = false;
      if (action === 'fork') forkDialog.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent = 'Retry fork';
      if (action === 'fork' && !forkDialog.open) { error.textContent = targetError.textContent; error.hidden = false; }
    } finally {
      busy = false; controls();
      if (targetError.hidden) schedule();
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
      startup.configure(persistence.startupConfiguration === true);
      security.configure({ internetControl: capabilities?.networking?.internetControl === true,
        egressPolicies: capabilities?.networking?.egressPolicies === true, secrets: capabilities?.secrets?.vault === true });
      observations.configure(observability);
      data = result;
      workspaces.updateContainers(result.containers);
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
      usage.hidden = true;
      pagination.hidden = true;
      status.textContent = 'Container status is unavailable.';
      onLoadError?.();
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
    status.textContent = method === 'POST' ? 'Starting your container…' : 'Deleting your container…';
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
        : cause.message === 'invalid_network_rules' ? 'Enter at least one allowed destination, with no more than 64 allow or deny rules.'
        : cause.message === 'network_unavailable' ? 'The selected network policy is unavailable. Refresh before choosing another setting.'
        : ['invalid_network_policy', 'invalid_secret_bindings', 'secret_not_found', 'secret_binding_not_allowed'].includes(cause.message) ? 'Check the outbound rules and selected secrets. Every secret hostname must be allowed by the policy.'
        : ['network_policy_unavailable', 'secrets_unavailable', 'secret_mediation_unavailable'].includes(cause.message) ? 'The selected outbound policy or secret service is unavailable. Try again when service is restored.'
        : cause.message === 'production_requires_usage' ? 'Production requires prepaid compute funding. Add balance in billing.'
        : cause.message === 'insufficient_production_balance' ? 'Fund at least 24 hours of runtime for the resulting production fleet, and ensure your remaining monthly spending cap covers those 24 hours.'
        : cause.message === 'production_unavailable' ? 'The production runtime is unavailable. Refresh and try again.'
        : cause.message === 'invalid_startup_command' ? 'Enter a startup command of up to 4,096 characters.'
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
          ? `Your account allows ${data?.limits?.maxContainers ?? 'the current maximum'} running containers. Stop one to create another.`
          : cause.message === 'spend_limit_reached' ? 'Available funding or your monthly spending cap is used or reserved. Stop a machine, add balance, or increase the cap in billing.'
          : cause.message === 'billing_reconciliation_required' ? 'Billing needs payment verification. Contact support before starting more machines.'
          : cause.message === 'subscription_required'
            ? 'Add prepaid balance to fund container runtime.'
            : cause.message === 'container_not_running'
              ? 'This container has already stopped or been replaced. Refresh to see the current containers.'
            : cause.message === 'billing_unavailable'
              ? 'Billing is temporarily unavailable. Try again shortly.'
          : `Could not ${method === 'POST' ? 'create' : 'delete'} your container. Refresh to check its status.`;
      mutationError.replaceChildren();
      mutationError.append(document.createTextNode(message));
      if (['subscription_required', 'production_requires_usage', 'insufficient_production_balance', 'spend_limit_reached'].includes(cause.message)) {
        const link = document.createElement('a');
        link.href = '/pricing/';
        link.textContent = ' Add balance or adjust cap';
        mutationError.append(link);
      }
      mutationError.hidden = false;
      data = null;
      usage.hidden = true;
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
    startup.dispose();
    security.dispose();
    observations.dispose();
    previews.dispose();
    closeTerminal();
    launch.close();
    forkDialog.close();
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
  function selectTab(tab: typeof activeTab) {
    activeTab = tab;
    for (const button of tabs) {
      const selected = button.dataset.resourceTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    panel.hidden = tab === 'workspaces' || tab === 'secrets';
    panel.setAttribute('aria-labelledby', `${tab}-tab`);
    filters.hidden = tab !== 'containers';
    openLaunch.hidden = tab !== 'containers';
    refresh.hidden = tab === 'workspaces' || tab === 'secrets';
    privateServices.setVisible(tab === 'networks');
    workspaces.setVisible(tab === 'workspaces');
    security.setVisible(tab === 'secrets');
    render();
  }
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(button.dataset.resourceTab as typeof activeTab));
    button.addEventListener('keydown', event => {
      const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault();
      tabs[target].click();
      tabs[target].focus();
    });
  });
  search.addEventListener('input', () => { page = 0; render(); });
  selectTab('containers');
  sizePicker.addEventListener('change', controls);
  openLaunch.addEventListener('click', () => {
    selectImageTab('stock');
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
  forkForm.onsubmit = event => { event.preventDefault(); if (forkSource && forkName.value.trim() && forkForm.reportValidity()) runLifecycle('fork', forkSource, forkName.value.trim()); };
  forkDialog.querySelector<HTMLButtonElement>('[data-fork-close]')!.onclick = () => forkDialog.close();
  launchForm.addEventListener('submit', event => { event.preventDefault(); mutate('POST'); });
  refresh.addEventListener('click', () => load());
  function selectImageTab(tab: typeof imageTab) {
    imageTab = tab;
    for (const button of imageTabs) {
      const selected = button.dataset.imageTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    stockPanel.hidden = tab !== 'stock';
    customPanel.hidden = tab !== 'custom';
    (tab === 'stock' ? stockPanel : customLaunch).append(launchForm);
    launchError.hidden = true;
    renderImages();
    controls();
  }
  imageTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectImageTab(button.dataset.imageTab as typeof imageTab));
    button.addEventListener('keydown', event => {
      const target = event.key === 'ArrowRight' ? (index + 1) % imageTabs.length
        : event.key === 'ArrowLeft' ? (index + imageTabs.length - 1) % imageTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? imageTabs.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault();
      imageTabs[target].click();
      imageTabs[target].focus();
    });
  });
  function renderImages() {
    launchForm.hidden = imageTab === 'custom' && !customImages.length;
    const key = JSON.stringify([imageTab, catalog, customImages]);
    if (key === imageOptionsKey) return;
    imageOptionsKey = key;
    const selected = imageSelect.value;
    imageSelect.replaceChildren();
    if (imageTab === 'stock') {
      for (const image of catalog) imageSelect.add(new Option(image.name, image.id === 'node' ? '' : `catalog:${image.id}`));
    } else {
      for (const image of customImages) imageSelect.add(new Option(image.name, image.id));
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
    selectImageTab('custom');
    imageSelect.value = id;
    launchError.hidden = true;
    if (!launch.open) launch.showModal();
    containerName.focus();
  }
  previous.addEventListener('click', () => { if (!previous.disabled) { page--; render(); previous.focus(); } });
  next.addEventListener('click', () => { if (!next.disabled) { page++; render(); next.focus(); } });
  return { load, dispose, setImages, selectImage };
}
