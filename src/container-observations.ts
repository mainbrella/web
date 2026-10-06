import type { ContainerIdentity, Container, ClientOptions, ObservabilityCapabilities } from './types.ts';
interface LifecycleEvent extends ContainerIdentity { sequence: number; occurredAt: string; type: string; reason?: string }
interface LifecyclePage { events: LifecycleEvent[]; nextCursor: number; hasMore: boolean; historyTruncated: boolean }
type ObservationResult<K> = K extends 'events' ? LifecyclePage : ReturnType<typeof workloadSummary>;
import { API_ORIGIN } from './auth.ts';
import { createContainerWebhooks } from './container-webhooks.ts';
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function lifecyclePage(input: unknown, container: ContainerIdentity, cursor = 0): LifecyclePage {
  const value = input as LifecyclePage | null;
  if (!value || !Array.isArray(value.events) || value.events.length > 100 || !Number.isSafeInteger(value.nextCursor)
    || value.nextCursor < cursor || typeof value.hasMore !== 'boolean' || typeof value.historyTruncated !== 'boolean') throw new Error('invalid_response');
  let previous = cursor; const ids = new Set();
  const events = value.events.map(event => {
    if (!uuid(event.id) || ids.has(event.id) || event.createdAt !== container.createdAt || !Number.isSafeInteger(event.sequence)
      || event.sequence <= previous || !['starting', 'started', 'failed', 'stopped'].includes(event.type) || !iso(event.occurredAt)
      || event.reason !== undefined && (typeof event.reason !== 'string' || !/^[a-z_]{1,40}$/.test(event.reason))) throw new Error('invalid_response');
    ids.add(event.id); previous = event.sequence;
    return { id: event.id, sequence: event.sequence, createdAt: event.createdAt, occurredAt: event.occurredAt, type: event.type, reason: event.reason };
  });
  if (value.nextCursor !== previous || value.hasMore && !events.length) throw new Error('invalid_response');
  return { events, nextCursor: value.nextCursor, hasMore: value.hasMore, historyTruncated: value.historyTruncated };
}
export function workloadSummary(input: unknown, container: ContainerIdentity) {
  const value = input as { id: string; createdAt: string; state: string; buckets: { cpuSeconds: number | null; memoryPeakBytes: number | null }[] } | null;
  if (!value || value.id !== container.id || value.createdAt !== container.createdAt || !['observed', 'unobserved'].includes(value.state)
    || !Array.isArray(value.buckets) || value.buckets.length > 1441 || (value.state === 'unobserved' ? value.buckets.length : !value.buckets.length)) throw new Error('invalid_response');
  let cpuSeconds = 0, memoryPeakBytes = null, cpuKnown = value.buckets.length > 0;
  for (const bucket of value.buckets) {
    for (const key of ['cpuSeconds', 'memoryPeakBytes'] as const) if (bucket[key] !== null && (typeof bucket[key] !== 'number' || !Number.isFinite(bucket[key]) || bucket[key] < 0)) throw new Error('invalid_response');
    if (bucket.cpuSeconds === null) cpuKnown = false; else cpuSeconds += bucket.cpuSeconds;
    if (!Number.isFinite(cpuSeconds)) throw new Error('invalid_response');
    if (bucket.memoryPeakBytes !== null) memoryPeakBytes = Math.max(memoryPeakBytes ?? 0, bucket.memoryPeakBytes);
  }
  return { state: value.state, cpuSeconds: cpuKnown ? cpuSeconds : null, memoryPeakBytes };
}
export function createObservationClient({ fetcher = fetch, onUnauthenticated }: ClientOptions = {}) {
  return async <K extends "events" | "metrics">(container: ContainerIdentity, kind: K, { cursor = 0, signal }: { cursor?: number; signal?: AbortSignal } = {}): Promise<ObservationResult<K>> => {
    const url = new URL(`${API_ORIGIN}/containers/${kind}`);
    url.searchParams.set('id', container.id); url.searchParams.set('createdAt', container.createdAt);
    if (kind === 'events') { url.searchParams.set('cursor', String(cursor)); url.searchParams.set('limit', '100'); }
    const response = await fetcher(url, { credentials: 'include', redirect: 'error', headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (response.status === 401) onUnauthenticated?.();
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 404 ? 'history_expired' : 'observations_unavailable');
    return (kind === 'events' ? lifecyclePage(value, container, cursor) : workloadSummary(value, container)) as ObservationResult<K>;
  };
}
const reasons: Record<string, string> = { requested: 'Requested stop', session_expired: 'Session expired', subscription_required: 'Paid access ended',
  runtime_restart: 'Runtime restarted', startup_failed: 'Startup failed', runtime_failed: 'Runtime failed', runtime_stopped: 'Runtime stopped', metadata_missing: 'Runtime unavailable' };
const types: Record<string, string> = { starting: 'Starting', started: 'Ready', failed: 'Failed', stopped: 'Stopped' };

export function createContainerObservations({ onUnauthenticated }: Pick<ClientOptions, "onUnauthenticated">) {
  const host = document.querySelector<HTMLElement>('#container-observations')!;
  const title = host.querySelector<HTMLElement>('h3')!, identity = host.querySelector<HTMLElement>('[data-history-identity]')!, rows = host.querySelector<HTMLElement>('ol')!;
  const message = host.querySelector<HTMLElement>('[role="status"]')!, error = host.querySelector<HTMLElement>('[role="alert"]')!, metrics = host.querySelector<HTMLElement>('[data-history-metrics]')!;
  const refresh = host.querySelector<HTMLButtonElement>('[data-history-refresh]')!, more = host.querySelector<HTMLButtonElement>('[data-history-more]')!, close = host.querySelector<HTMLButtonElement>('[data-history-close]')!;
  const request = createObservationClient({ onUnauthenticated });
  const webhooks = createContainerWebhooks(host.querySelector<HTMLDetailsElement>('[data-container-webhooks]')!, { onUnauthenticated });
  let selected: Container | null | undefined, sourceButton: HTMLButtonElement | undefined, abort: AbortController | undefined;
  let capabilities: ObservabilityCapabilities = {}, events: LifecycleEvent[] = [], cursor = 0, version = 0, disposed = false, busy = false;
  function controls() { refresh.disabled = disposed || busy; more.disabled = disposed || busy; }
  function render() {
    rows.replaceChildren(...events.map(event => {
      const row = document.createElement('li'), at = document.createElement('time'), label = document.createElement('span');
      at.dateTime = event.occurredAt; at.textContent = new Date(event.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
      label.textContent = `${types[event.type]}${event.reason ? ` · ${reasons[event.reason] ?? 'Runtime event'}` : ''}`;
      row.append(at, label); return row;
    }));
  }
  async function load(append = false) {
    if (!selected || disposed || busy) return;
    abort?.abort(); abort = new AbortController(); const current = ++version, container = selected;
    busy = true; controls(); error.hidden = true; message.textContent = 'Loading history…';
    const results = await Promise.allSettled([request(container, 'events', { cursor: append ? cursor : 0, signal: abort.signal }),
      ...(!append && capabilities.metrics ? [request(container, 'metrics', { signal: abort.signal })] : [])]);
    if (disposed || version !== current) return;
    const history = results[0];
    if (history.status === 'fulfilled') {
      const page = history.value; events = append ? [...events, ...page.events] : page.events; cursor = page.nextCursor; more.hidden = !page.hasMore;
      message.textContent = page.historyTruncated ? 'Earlier events have expired.' : events.length ? '' : 'No lifecycle events yet.'; render();
    } else {
      message.textContent = ''; error.textContent = history.reason.message === 'history_expired' ? 'No retained history for this generation.' : 'Could not load history. Refresh to try again.'; error.hidden = false;
    }
    if (results[1]) {
      const observation = results[1];
      if (observation.status === 'rejected') metrics.textContent = 'Workload metrics unavailable. Refresh to try again.';
      else {
        const value = observation.value;
        metrics.textContent = value.state === 'unobserved' ? 'No workload observations yet.'
          : `Last hour · CPU time ${value.cpuSeconds === null ? 'unavailable' : `${value.cpuSeconds.toFixed(2)} s`} · Peak RAM ${value.memoryPeakBytes === null ? 'unavailable' : `${(value.memoryPeakBytes / 1048576).toFixed(1)} MiB`}`;
      }
      metrics.hidden = false;
    }
    busy = false; controls();
  }
  refresh.onclick = () => load(); more.onclick = () => load(true);
  close.onclick = () => { version++; abort?.abort(); selected = null; busy = false; webhooks.clear(); host.hidden = true;
    (sourceButton?.isConnected ? sourceButton : document.querySelector<HTMLButtonElement>('#containers-refresh')!).focus(); };
  return {
    configure(value: ObservabilityCapabilities = {}) { capabilities = value; if (!value.webhooks) webhooks.clear(); if (!value.lifecycleEvents) { version++; abort?.abort(); selected = null; busy = false; host.hidden = true; webhooks.clear(); } },
    attach(actions: HTMLElement, container: Container) {
      if (!capabilities.lifecycleEvents) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = 'History'; button.dataset.action = 'history';
      button.setAttribute('aria-controls', host.id);
      button.onclick = () => {
        abort?.abort(); version++; busy = false; selected = { ...container }; sourceButton = button; events = []; cursor = 0;
        title.textContent = `History · ${container.imageName || container.name || container.id}`;
        identity.textContent = `${container.id} · Created ${new Date(container.createdAt).toLocaleString()}`;
        webhooks.select(container, capabilities.webhooks === true);
        rows.replaceChildren(); metrics.hidden = true; more.hidden = true; host.hidden = false; title.focus(); load();
      };
      actions.insertBefore(button, actions.lastElementChild);
    },
    dispose() { disposed = true; version++; abort?.abort(); selected = null; events = []; rows.replaceChildren(); metrics.textContent = ''; webhooks.clear(); host.hidden = true; },
  };
}
