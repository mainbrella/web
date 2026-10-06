import { trackMachineStart } from './acquisition-analytics.ts';
import type { Container, ContainerData, ContainerIdentity, ContainerLimits, MachineSize, Image, ObservabilityCapabilities, PersistenceCapabilities } from './types.ts';
import { API_ORIGIN } from './auth.ts';
import { createContainerPreviews } from './container-previews.ts';
import { createContainerObservations } from './container-observations.ts';
import { createWorkspacesDashboard } from './workspaces-dashboard.ts';

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
  const sizeSelect = document.querySelector<HTMLSelectElement>('#container-size')!;
  const sizeRate = document.querySelector<HTMLElement>('#container-size-rate')!;
  let sizeOptionsKey = '';
  const imageSelect = document.querySelector<HTMLSelectElement>('#container-image')!;
  const create = document.querySelector<HTMLButtonElement>('#container-create')!;
  const refresh = document.querySelector<HTMLButtonElement>('#containers-refresh')!;
  const list = document.querySelector<HTMLElement>('#container-list')!;
  const status = document.querySelector<HTMLElement>('#containers-status')!;
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
    create.disabled = busy || disposed || !canCreateContainer(data, sizeSelect?.value ?? 'lite') || (!catalog.length && !customImages.length);
    refresh.disabled = busy || disposed;
    imageSelect.disabled = busy || disposed;
    if (sizeSelect) sizeSelect.disabled = busy || disposed || !data?.sizes?.length;
    if (sizeRate) {
      const size = data?.sizes?.find(item => item.id === sizeSelect.value);
      sizeRate.textContent = size ? `${size.cpuVcpu} vCPU · ${size.diskGB} GB disk · ${size.computeUnits} compute units/hour` : '';
    }
    list.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = busy || !data || disposed || (button.dataset.requiresRunning === 'true' && button.dataset.running !== 'true');
    });
    previous.disabled = busy || !data || disposed || page === 0;
    next.disabled = busy || !data || disposed || (page + 1) * pageSize >= data.containers.length;
    previews.setBusy(busy || !data || disposed);
    workspaces.setBusy(busy || !data || disposed);
  }

  async function request(method: string, id?: string, createdAt?: string) {
    const image = { ...imageSelection(imageSelect.value), ...(sizeSelect && data?.sizes?.length ? { size: sizeSelect.value } : {}) };
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
    if (sizeSelect && Array.isArray(data.sizes)) {
      const key = JSON.stringify(data.sizes);
      if (key !== sizeOptionsKey) {
        const selected = sizeSelect.value;
        sizeSelect.replaceChildren(...data.sizes.map(size => {
          const option = document.createElement('option');
          option.value = size.id;
          option.textContent = `${size.name} · ${size.memoryMiB < 1024 ? `${size.memoryMiB} MiB` : `${size.memoryMiB / 1024} GiB`} RAM`;
          return option;
        }));
        if (data.sizes.some(size => size.id === selected)) sizeSelect.value = selected;
        sizeOptionsKey = key;
      }
    }
    if (Array.isArray(data.imageCatalog)) {
      catalog = data.imageCatalog.filter(image => typeof image.id === 'string' && typeof image.name === 'string');
      renderImages();
    }
    if (terminal && !data.containers.some(c => c.id === terminal?.id && c.createdAt === terminal?.createdAt)) closeTerminal(true);
    list.hidden = data.containers.length === 0;
    page = Math.min(page, Math.max(0, Math.ceil(data.containers.length / pageSize) - 1));
    pagination.hidden = data.containers.length <= pageSize;
    range.textContent = `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, data.containers.length)} of ${data.containers.length}`;
    const remaining = Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts);
    status.textContent = data.active
      ? `${data.containers.length} of ${data.limits.maxContainers} container slots in use · ${remaining} starts remaining this month.${data.usage.availableComputeUnitHours !== undefined ? ` ${data.usage.computeUnitHours.toFixed(1)} compute-unit hours used; ${data.usage.reservedComputeUnitHours.toFixed(1)} reserved for running sessions; ${data.usage.availableComputeUnitHours.toFixed(1)} available.` : ''}`
      : 'No active plan. Choose a plan to start containers.';
    const hours = Math.round(data.limits.maxSessionMs / 3600000);
    const idleMinutes = Math.round(data.limits.idleTimeoutMs / 60000);
    document.querySelector<HTMLElement>('#container-limits')!.textContent = data.active
      ? `${data.limits.maxContainers} concurrent containers${data.limits.maxConcurrentComputeUnits ? ` within ${data.limits.maxConcurrentComputeUnits} compute units` : ""} · Choose your machine size. Sessions last up to ${hours} ${hours === 1 ? 'hour' : 'hours'} and stop after ${idleMinutes} idle minutes. ${data.limits.maxStartsPerMonth} starts per month.`
      : 'Choose a monthly plan to create containers. All plans offer five machine sizes, with SSH and browser terminal access.';
    if (access && (!data.containers.some(c => c.id === access?.id && c.createdAt === access?.createdAt) || access.expiresAt <= Date.now())) access = null;
    const rows = data.containers.slice(page * pageSize, (page + 1) * pageSize);
    const rowVersion = JSON.stringify({ page, rows, access, previewsSupported, observability, persistence, today: new Date().toDateString() });
    if (rowVersion === renderedRows) { controls(); return; }
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedRow = focused?.closest<HTMLElement>('[data-container-id]');
    const focus = focusedRow ? { id: focusedRow.dataset.containerId, createdAt: focusedRow.dataset.createdAt,
      action: focused!.dataset.action, start: (focused as HTMLInputElement).selectionStart, end: (focused as HTMLInputElement).selectionEnd } : null;
    list.replaceChildren();
    for (const container of rows) {
      const row = document.createElement('li');
      row.className = 'container-row';
      row.dataset.containerId = container.id;
      row.dataset.createdAt = container.createdAt;
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = container.imageName || container.name || container.id;
      const state = document.createElement('p');
      state.className = 'dashboard-status';
      const expiry = new Date(container.expiresAt);
      const expiryOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit',
        ...(expiry.toDateString() !== new Date().toDateString() ? { month: 'short', day: 'numeric' } : {}) };
      const running = container.status === 'running';
      const stateLabel = running ? 'Running' : container.status === 'starting' ? 'Starting…' : 'Stopping…';
      state.textContent = `${stateLabel}${container.size ? ` · ${container.size.toUpperCase()}` : ""} · Stops by ${expiry.toLocaleString([], expiryOptions)}`;
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'dashboard-retry';
      stop.textContent = 'Stop';
      stop.dataset.action = 'stop';
      stop.setAttribute('aria-label', `Stop ${container.id}`);
      stop.addEventListener('click', () => {
        if (window.confirm(`Stop ${container.name || container.id}? Its files will be lost.`)) mutate('DELETE', container.id, container.createdAt);
      });
      details.append(name, state);
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
      shell.className = 'button button-small';
      shell.textContent = 'Open terminal';
      shell.dataset.action = 'terminal';
      shell.dataset.requiresRunning = 'true';
      shell.dataset.running = String(running);
      shell.addEventListener('click', () => connectTerminal(container));
      actions.append(shell, connect, stop);
      row.append(details, actions);
      previews.attach(row, actions, container);
      observations.attach(actions, container);
      workspaces.attach(actions,container);
      list.append(row);
      if (access?.id === container.id) {
        const connection = document.createElement('li');
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
        list.append(connection);
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
      render();
      error.hidden = true;
    } catch {
      if (disposed || version !== stateVersion) return;
      // Disable creation while the current state is unknown, including when a
      // background refresh fails after the last known container stopped.
      data = null;
      list.hidden = true;
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
    if (method === 'DELETE' && terminal?.id === id && terminal?.createdAt === createdAt) closeTerminal(true);
    busy = true;
    stateVersion++;
    clearTimeout(timer);
    error.hidden = true;
    create.textContent = method === 'POST' ? 'Creating…' : 'Create container';
    status.textContent = method === 'POST' ? 'Starting your container…' : 'Stopping your container…';
    controls();
    try {
      const result = await request(method, id, createdAt);
      if (disposed) return;
      data = result;
      if (method === 'POST') trackMachineStart(sizeSelect?.value || 'lite');
      render();
      if (method === 'DELETE') refresh.focus();
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
      if (disposed) return;
      const message = cause.message === 'compute_allowance_exhausted'
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
      error.replaceChildren();
      error.append(document.createTextNode(message));
      if (cause.message === 'subscription_required') {
        const link = document.createElement('a');
        link.href = '/pricing/';
        link.textContent = ' View plans';
        error.append(link);
      }
      error.hidden = false;
      data = null;
      status.textContent = 'Refresh containers to check the current state.';
    } finally {
      busy = false;
      create.textContent = 'Create container';
      controls();
      // Leave mutation errors visible until the user reconciles the state.
      if (error.hidden) schedule();
    }
  }

  function dispose() {
    workspaces.dispose();
    observations.dispose();
    previews.dispose();
    closeTerminal();
    disposed = true;
    clearTimeout(timer);
    data = null;
    access = null;
    list.replaceChildren();
    pagination.hidden = true;
    controls();
  }

  sizeSelect?.addEventListener('change', controls);
  create.addEventListener('click', () => mutate('POST'));
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
  function selectImage(id: string) { imageSelect.value = id; imageSelect.focus(); }
  previous.addEventListener('click', () => { if (!previous.disabled) { page--; render(); previous.focus(); } });
  next.addEventListener('click', () => { if (!next.disabled) { page++; render(); next.focus(); } });
  return { load, dispose, setImages, selectImage };
}
