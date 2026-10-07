import type { ClientOptions, ContainerIdentity, Container } from './types.ts';
interface PreviewGrant extends ContainerIdentity { port: number; expiresAt: number; url?: string }
type PreviewMethod = 'GET' | 'POST' | 'DELETE';
type PreviewResult<M> = M extends 'GET' ? PreviewGrant[] : M extends 'POST' ? PreviewGrant : { revoked: true };
class PreviewError extends Error { previewId?: string }
interface PreviewState {
  key: string; container: Container; toggle: HTMLButtonElement; panel: HTMLDivElement; port: HTMLInputElement;
  create: HTMLButtonElement; refresh: HTMLButtonElement; rows: HTMLUListElement; message: HTMLParagraphElement; error: HTMLParagraphElement;
  grants: PreviewGrant[]; known: boolean; busy: boolean; running: boolean; pending: string | null;
}
import { API_ORIGIN } from './auth.ts';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const validPreviewPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535;

export function previewMetadata(input: unknown, createdAt: string, withUrl = false): PreviewGrant {
  const value = input as PreviewGrant | null;
  if (!value || !validId(value.id) || !validPreviewPort(value.port) || value.createdAt !== createdAt
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new Error('invalid_response');
  const grant: PreviewGrant = { id: value.id, port: value.port, createdAt, expiresAt: value.expiresAt };
  if (withUrl) {
    const url = new URL(value.url!);
    const api = new URL(API_ORIGIN);
    const local = api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname)
      && url.protocol === 'http:' && url.port === api.port && /^[a-f0-9]{48}\.localhost$/.test(url.hostname);
    const production = url.protocol === 'https:' && !url.port
      && /^[a-f0-9]{48}\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
      && !url.hostname.endsWith('.mainbrella.com');
    if ((!local && !production) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) throw new Error('invalid_response');
    grant.url = url.href;
  }
  return grant;
}

export function createPreviewClient({ fetcher = fetch, onUnauthenticated, signal }: ClientOptions = {}) {
  return async <M extends PreviewMethod = 'GET'>(container: ContainerIdentity, method: M = 'GET' as M, value?: string | number): Promise<PreviewResult<M>> => {
    const url = new URL(`${API_ORIGIN}/containers/previews`);
    url.searchParams.set('id', container.id);
    url.searchParams.set('createdAt', container.createdAt);
    if (method === 'DELETE') url.searchParams.set('previewId', String(value));
    const response = await fetcher(url, { method, credentials: 'include', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ port: value }) } : {}) });
    if (response.status === 401) onUnauthenticated?.();
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const cause = new PreviewError(['preview_limit', 'container_not_running', 'subscription_required', 'preview_reconciliation_required']
        .includes(result?.error) ? result.error : 'previews_unavailable');
      if (cause.message === 'preview_reconciliation_required' && validId(result?.previewId)) cause.previewId = result.previewId;
      throw cause;
    }
    if (method === 'POST') return previewMetadata(result, container.createdAt, true) as PreviewResult<M>;
    if (method === 'DELETE') {
      if (result?.revoked !== true) throw new Error('invalid_response');
      return result as PreviewResult<M>;
    }
    if (!Array.isArray(result?.previews) || result.previews.length > 8) throw new Error('invalid_response');
    return result.previews.map((grant: unknown) => previewMetadata(grant, container.createdAt)) as PreviewResult<M>;
  };
}

// Keep one-time URLs and form values only in memory for their exact generation.
// Reuse the DOM on dashboard polling so it cannot erase an in-progress form.
export function createContainerPreviews({ onUnauthenticated }: Pick<ClientOptions, "onUnauthenticated">) {
  const states = new Map<string, PreviewState>();
  const abort = new AbortController();
  const request = createPreviewClient({ onUnauthenticated, signal: abort.signal });
  let supported = false, externalBusy = false, disposed = false;

  function current(state: PreviewState) { return !disposed && states.get(state.key) === state; }
  function controls(state: PreviewState) {
    const disabled = externalBusy || state.busy || !state.running;
    state.toggle.disabled = externalBusy || !state.running;
    state.port.disabled = disabled || !supported;
    state.create.disabled = disabled || !supported || !state.known || state.grants.length >= 8 || Boolean(state.pending);
    state.refresh.disabled = disabled;
    state.rows.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = disabled; });
    state.rows.querySelectorAll<HTMLAnchorElement>('a').forEach(link => { link.hidden = !state.running; });
  }

  function render(state: PreviewState) {
    state.grants = state.grants.filter(grant => grant.expiresAt > Date.now());
    state.rows.replaceChildren();
    for (const grant of state.grants) {
      const row = document.createElement('li');
      const info = document.createElement('span');
      info.textContent = `Port ${grant.port} · Expires ${new Date(grant.expiresAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      row.append(info);
      if (grant.url) {
        const open = document.createElement('a');
        open.href = grant.url;
        open.textContent = 'Open preview';
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.referrerPolicy = 'no-referrer';
        open.dataset.action = `preview-open-${grant.id}`;
        row.append(open);
      } else {
        const note = document.createElement('span');
        note.className = 'dashboard-status';
        note.textContent = 'URL available only when created.';
        row.append(note);
      }
      row.append(revokeButton(state, grant.id));
      state.rows.append(row);
    }
    if (state.pending && !state.grants.some(grant => grant.id === state.pending)) {
      const row = document.createElement('li');
      row.append(document.createTextNode('Preview cleanup incomplete.'), revokeButton(state, state.pending));
      state.rows.append(row);
    }
    if (state.known && !state.rows.children.length) {
      const empty = document.createElement('li');
      empty.className = 'dashboard-status';
      empty.textContent = 'No active previews.';
      state.rows.append(empty);
    }
    controls(state);
  }

  function revokeButton(state: PreviewState, id: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dashboard-retry';
    button.textContent = 'Revoke';
    button.dataset.action = `preview-revoke-${id}`;
    button.setAttribute('aria-label', `Revoke preview ${id}`);
    button.onclick = () => operate(state, 'DELETE', id);
    return button;
  }

  async function operate(state: PreviewState, method: PreviewMethod = 'GET', value?: string | number) {
    if (!current(state) || state.busy || externalBusy || !state.running) return;
    if (method === 'POST' && state.create.disabled) return;
    state.busy = true;
    state.message.textContent = method === 'POST' ? 'Creating link…' : method === 'DELETE' ? 'Revoking…' : 'Loading previews…';
    state.error.hidden = true;
    controls(state);
    try {
      const result = await request(state.container, method, value);
      if (!current(state)) return;
      if (method === 'GET') {
        const urls = new Map(state.grants.map(grant => [grant.id, grant.url]));
        state.grants = (result as PreviewGrant[]).map(grant => ({ ...grant, ...(urls.get(grant.id) ? { url: urls.get(grant.id) } : {}) }));
        state.known = true;
      } else if (method === 'POST') state.grants.push(result as PreviewGrant);
      else {
        state.grants = state.grants.filter(grant => grant.id !== value);
        if (state.pending === value) state.pending = null;
      }
      state.message.textContent = method === 'DELETE' ? 'Preview revoked.' : '';
      render(state);
    } catch (caught) {
      const cause = caught instanceof PreviewError ? caught : new PreviewError(caught instanceof Error ? caught.message : "Unexpected error");
      if (!current(state)) return;
      if (cause.previewId) state.pending = cause.previewId;
      if (method === 'GET' || method === 'POST') state.known = false;
      state.message.textContent = '';
      state.error.textContent = cause.previewId
        ? 'Cleanup is incomplete. Revoke the preview again to close any active connections.'
        : cause.message === 'preview_limit' ? 'Eight previews are already active. Refresh previews and revoke one.'
        : cause.message === 'container_not_running' ? 'This container has stopped. Refresh containers.'
        : cause.message === 'subscription_required' ? 'An active plan is required to manage previews.'
        : method === 'POST' ? 'Creation may have succeeded. Refresh previews and revoke any unwanted grant before creating another link.'
        : method === 'DELETE' ? 'Revocation could not be confirmed. Retry Revoke to close any active connections.'
        : 'Could not load previews. Refresh previews to try again.';
      state.error.hidden = false;
      render(state);
    } finally {
      state.busy = false;
      if (current(state)) controls(state);
    }
  }

  function build(container: Container, key: string): PreviewState {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dashboard-retry';
    toggle.textContent = 'Preview';
    toggle.dataset.action = 'preview';
    toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'container-previews';
    panel.id = `previews-${container.id}`;
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Previews for ${container.name || container.imageName || container.id}`);
    toggle.setAttribute('aria-controls', panel.id);
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Port';
    const port = document.createElement('input');
    port.type = 'number'; port.min = '1024'; port.max = '65535'; port.step = '1'; port.required = true;
    port.value = '3000'; port.inputMode = 'numeric'; port.dataset.action = 'preview-port';
    label.append(port);
    const create = document.createElement('button');
    create.type = 'submit'; create.className = 'dashboard-retry'; create.textContent = 'Create link';
    create.dataset.action = 'preview-create';
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.className = 'dashboard-retry'; refresh.textContent = 'Refresh previews';
    refresh.dataset.action = 'preview-refresh';
    form.append(label, create, refresh);
    const note = document.createElement('p');
    note.className = 'dashboard-status';
    note.id = `${panel.id}-note`;
    note.textContent = 'Start your server first. Links last up to 15 minutes and give anyone who has them access.';
    form.setAttribute('aria-describedby', note.id);
    const rows = document.createElement('ul');
    rows.className = 'preview-list'; rows.setAttribute('aria-label', 'Active previews');
    const message = document.createElement('p'); message.className = 'dashboard-status'; message.setAttribute('role', 'status');
    const error = document.createElement('p'); error.className = 'dashboard-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    panel.append(form, note, rows, message, error);
    const state: PreviewState = { key, container, toggle, panel, port, create, refresh, rows, message, error, grants: [], known: false, busy: false, running: true, pending: null };
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden && !state.known) operate(state);
    };
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity() && validPreviewPort(port.valueAsNumber)) operate(state, 'POST', port.valueAsNumber); };
    refresh.onclick = () => operate(state);
    return state;
  }

  const timer = setInterval(() => {
    for (const state of states.values()) if (state.grants.some(grant => grant.expiresAt <= Date.now())) render(state);
  }, 1000);

  return {
    sync(containers: Container[], enabled: boolean) {
      supported = enabled === true;
      for (const [key, state] of states) {
        const container = containers.find(item => item.id === state.container.id && item.createdAt === state.container.createdAt);
        if (!container) { state.panel.remove(); state.toggle.remove(); states.delete(key); }
        else { state.running = container.status === 'running'; controls(state); }
      }
    },
    attach(row: HTMLElement, actions: HTMLElement, container: Container) {
      const key = JSON.stringify([container.id, container.createdAt]);
      if (!supported && !states.has(key)) return;
      let state = states.get(key);
      if (!state) { state = build(container, key); states.set(key, state); }
      state.running = container.status === 'running';
      actions.insertBefore(state.toggle, actions.lastElementChild);
      row.append(state.panel);
      controls(state);
    },
    setBusy(busy: boolean) { externalBusy = busy; for (const state of states.values()) controls(state); },
    dispose() { disposed = true; abort.abort(); clearInterval(timer); states.clear(); },
  };
}
