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
    list.replaceChildren();
    list.hidden = data.containers.length === 0;
    const remaining = Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts);
    status.textContent = data.containers.length
      ? `${remaining} starts remaining this month.`
      : `You have no running containers. ${remaining} starts remaining this month.`;
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
      row.append(details, stop);
      list.append(row);
    }
    controls();
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
    disposed = true;
    clearTimeout(timer);
    data = null;
    list.replaceChildren();
    controls();
  }

  create.addEventListener('click', () => mutate('POST'));
  refresh.addEventListener('click', () => load());
  return { load, dispose };
}
