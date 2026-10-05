import { API_ORIGIN } from './auth.js';

export function createContainersDashboard({ onUnauthenticated }) {
  const create = document.querySelector('#container-create');
  const refresh = document.querySelector('#containers-refresh');
  const list = document.querySelector('#container-list');
  const status = document.querySelector('#containers-status');
  const error = document.querySelector('#containers-error');
  let data = null;
  let busy = false;
  let disposed = false;
  let timer;
  let access = null;
  let terminal = null;
  const terminalHost = document.querySelector('#container-terminal');

  function closeTerminal(stopped = false) {
    terminal?.session.dispose();
    terminal = null;
    terminalHost.hidden = !stopped;
    if (stopped) {
      terminalHost.querySelector('[role="status"]').textContent = 'Container stopped.';
      terminalHost.querySelector('.terminal-output').replaceChildren();
      terminalHost.querySelector('.terminal-output').hidden = true;
      terminalHost.querySelector('button').onclick = () => { terminalHost.hidden = true; refresh.focus(); };
    }
  }

  async function connectTerminal(container) {
    if (busy || disposed) return;
    busy = true;
    controls();
    let openContainerTerminal;
    try {
      ({ openContainerTerminal } = await import('./container-terminal.js'));
    } catch {
      error.textContent = 'Could not load the terminal. Try again.';
      error.hidden = false;
      return;
    } finally {
      busy = false;
      controls();
    }
    if (disposed || !data?.containers.some(c => c.createdAt === container.createdAt)) return;
    closeTerminal();
    terminalHost.querySelector('button').onclick = null;
    terminalHost.querySelector('.terminal-output').hidden = false;
    terminalHost.hidden = false;
    terminalHost.querySelector('[role="status"]').textContent = 'Connecting…';
    terminal = { createdAt: container.createdAt, session: openContainerTerminal(terminalHost, {
      createdAt: container.createdAt,
      onClose: () => { terminal = null; list.querySelector('button')?.focus(); },
    }) };
  }

  function controls() {
    create.disabled = busy || !data || data.containers.length > 0
      || data.usage.starts >= data.limits.maxStartsPerMonth;
    refresh.disabled = busy || disposed;
    list.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  }

  async function request(method) {
    const response = await fetch(`${API_ORIGIN}/containers`, {
      method, credentials: 'include', headers: { accept: 'application/json' },
    });
    if (response.status === 401) {
      dispose();
      onUnauthenticated();
      throw new Error('not_authenticated');
    }
    if (response.status === 429) throw new Error('container_quota_exceeded');
    const result = await response.json();
    if (!response.ok || !Array.isArray(result?.containers)
      || !Number.isInteger(result.usage?.starts)
      || !Number.isInteger(result.limits?.maxStartsPerMonth)) {
      throw new Error('containers_unavailable');
    }
    return result;
  }

  function render() {
    if (terminal && !data.containers.some(c => c.createdAt === terminal.createdAt)) closeTerminal(true);
    list.replaceChildren();
    list.hidden = data.containers.length === 0;
    const remaining = Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts);
    status.textContent = data.containers.length
      ? `${remaining} starts remaining this month.`
      : `You have no running containers. ${remaining} starts remaining this month.`;
    if (access && (!data.containers.some(c => c.createdAt === access.createdAt) || access.expiresAt <= Date.now())) access = null;
    for (const container of data.containers) {
      const row = document.createElement('li');
      row.className = 'container-row';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = container.name;
      const state = document.createElement('p');
      state.className = 'dashboard-status';
      const expiry = new Date(container.expiresAt);
      state.textContent = `Running · Stops by ${expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'dashboard-retry';
      stop.textContent = 'Stop';
      stop.setAttribute('aria-label', `Stop ${container.name}`);
      stop.addEventListener('click', () => mutate('DELETE'));
      details.append(name, state);
      const actions = document.createElement('div');
      actions.className = 'container-actions';
      const connect = document.createElement('button');
      connect.type = 'button';
      connect.className = 'dashboard-retry';
      connect.textContent = 'SSH';
      connect.addEventListener('click', () => connectSSH(container));
      const shell = document.createElement('button');
      shell.type = 'button';
      shell.className = 'button button-small';
      shell.textContent = 'Open terminal';
      shell.addEventListener('click', () => connectTerminal(container));
      actions.append(shell, connect, stop);
      row.append(details, actions);
      list.append(row);
      if (access?.createdAt === container.createdAt) {
        const connection = document.createElement('li');
        connection.className = 'container-ssh';
        const label = document.createElement('label');
        label.textContent = 'SSH command';
        const command = document.createElement('textarea');
        command.readOnly = true;
        command.rows = 3;
        command.value = access.command;
        label.append(command);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'dashboard-retry';
        copy.textContent = 'Copy command';
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
    controls();
  }

  async function connectSSH(container) {
    if (busy || disposed) return;
    busy = true;
    clearTimeout(timer);
    error.hidden = true;
    controls();
    try {
      const response = await fetch(`${API_ORIGIN}/containers/ssh`, {
        method: 'POST', credentials: 'include', headers: { accept: 'application/json' },
      });
      if (response.status === 401) { dispose(); onUnauthenticated(); return; }
      const result = await response.json();
      if (!response.ok || typeof result.command !== 'string' || !Number.isFinite(result.expiresAt)) {
        throw new Error(response.status === 429 ? 'limit' : 'unavailable');
      }
      if (disposed) return;
      access = { ...result, createdAt: container.createdAt };
      render();
      list.querySelector('textarea')?.focus();
    } catch (cause) {
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
      if (document.visibilityState === 'visible') load(true);
      else schedule();
    }, 15000);
  }

  async function load(background = false) {
    if (busy || disposed) return;
    busy = true;
    if (!background) error.hidden = true;
    controls();
    try {
      const result = await request('GET');
      if (disposed) return;
      data = result;
      render();
      error.hidden = true;
    } catch {
      if (disposed) return;
      // Disable creation while the current state is unknown, including when a
      // background refresh fails after the last known container stopped.
      data = null;
      list.hidden = true;
      status.textContent = 'Container status is unavailable.';
      error.textContent = 'Could not load containers. Refresh to try again.';
      error.hidden = false;
    } finally {
      busy = false;
      controls();
      schedule();
    }
  }

  async function mutate(method) {
    if (busy || disposed || !data || (method === 'POST' && create.disabled)) return;
    if (method === 'DELETE') closeTerminal(true);
    busy = true;
    clearTimeout(timer);
    error.hidden = true;
    create.textContent = method === 'POST' ? 'Creating…' : 'Create container';
    status.textContent = method === 'POST' ? 'Starting your container…' : 'Stopping your container…';
    controls();
    try {
      const result = await request(method);
      if (disposed) return;
      data = result;
      render();
      if (method === 'DELETE') refresh.focus();
    } catch (cause) {
      if (disposed) return;
      error.textContent = cause.message === 'container_quota_exceeded'
        ? 'You’ve used all 10 container starts for this month. Your allowance resets next month (UTC).'
        : `Could not ${method === 'POST' ? 'create' : 'stop'} your container. Refresh to check its status.`;
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
    closeTerminal();
    disposed = true;
    clearTimeout(timer);
    data = null;
    access = null;
    list.replaceChildren();
    controls();
  }

  create.addEventListener('click', () => mutate('POST'));
  refresh.addEventListener('click', () => load());
  return { load, dispose };
}
