import type { ContainerIdentity, ClientOptions } from './types.ts';
interface WebhookConfig extends ContainerIdentity { url: string; configuredAt: string; retainUntil: number }
interface WebhookDelivery { id: string; status: string; attempts: number; manualRetries: number }
type WebhookResult<M, S> = S extends '/deliveries' ? WebhookDelivery[] : S extends '/retry' ? WebhookDelivery : M extends 'DELETE' ? { removed: true } : M extends 'PUT' ? { config: WebhookConfig; signingSecret: string } : { config: WebhookConfig | null };
import { API_ORIGIN } from './auth.ts';
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function webhookConfig(input: unknown, container: ContainerIdentity) {
  const value = input as { webhook: WebhookConfig | null } | null;
  const config = value?.webhook;
  if (config === null) return null;
  if (!config || !uuid(config.id) || config.createdAt !== container.createdAt || !Number.isFinite(Date.parse(config.configuredAt))
    || !Number.isFinite(config.retainUntil) || typeof config.url !== 'string' || config.url.length > 2048) throw new Error('invalid_response');
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid_response');
  return { id: config.id, url: config.url, createdAt: config.createdAt, configuredAt: config.configuredAt, retainUntil: config.retainUntil };
}
export function webhookDeliveries(input: unknown): WebhookDelivery[] {
  const value = input as { deliveries: WebhookDelivery[] } | null;
  if (!Array.isArray(value?.deliveries) || value.deliveries.length > 256) throw new Error('invalid_response');
  const seen = new Set();
  return value.deliveries.map(item => {
    if (!uuid(item.id) || seen.has(item.id) || !['pending', 'sending', 'delivered', 'exhausted'].includes(item.status)
      || !Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.attempts > 8
      || !Number.isSafeInteger(item.manualRetries) || item.manualRetries < 0 || item.manualRetries > 3) throw new Error('invalid_response');
    seen.add(item.id); return { id: item.id, status: item.status, attempts: item.attempts, manualRetries: item.manualRetries };
  });
}
export function createWebhookClient({ fetcher = fetch, onUnauthenticated }: ClientOptions = {}) {
  return async <M extends string = 'GET', S extends string = ''>(container: ContainerIdentity, method: M = 'GET' as M, body?: unknown, suffix: S = '' as S, signal?: AbortSignal): Promise<WebhookResult<M, S>> => {
    const url = new URL(`${API_ORIGIN}/containers/webhook${suffix}`);
    url.searchParams.set('id', container.id); url.searchParams.set('createdAt', container.createdAt);
    const response = await fetcher(url, { method, credentials: 'include', redirect: 'error',
      headers: { accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (response.status === 401) onUnauthenticated?.();
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 400 ? 'invalid_webhook' : response.status === 409 ? 'webhook_conflict' : 'webhook_unavailable');
    if (suffix === '/deliveries') return webhookDeliveries(value) as WebhookResult<M, S>;
    if (suffix === '/retry') return webhookDeliveries({ deliveries: [value] })[0] as WebhookResult<M, S>;
    if (method === 'DELETE') { if (value?.removed !== true) throw new Error('invalid_response'); return value as WebhookResult<M, S>; }
    const config = webhookConfig(value, container);
    if (method === 'PUT' && (!config || !/^mbwh_[a-f0-9]{64}$/.test(value.signingSecret))) throw new Error('invalid_response');
    return { config, ...(method === 'PUT' ? { signingSecret: value.signingSecret } : {}) } as WebhookResult<M, S>;
  };
}

export function createContainerWebhooks(host: HTMLDetailsElement, { onUnauthenticated }: Pick<ClientOptions, "onUnauthenticated">) {
  const input = host.querySelector<HTMLInputElement>('input[type="url"]')!, form = host.querySelector<HTMLFormElement>('form')!, save = host.querySelector<HTMLButtonElement>('[data-webhook-save]')!;
  const remove = host.querySelector<HTMLButtonElement>('[data-webhook-remove]')!, refresh = host.querySelector<HTMLButtonElement>('[data-webhook-refresh]')!;
  const status = host.querySelector<HTMLElement>('[role="status"]')!, error = host.querySelector<HTMLElement>('[role="alert"]')!, list = host.querySelector<HTMLElement>('ul')!;
  const secret = host.querySelector<HTMLElement>('[data-webhook-secret]')!, secretInput = secret.querySelector<HTMLInputElement>('input')!;
  const request = createWebhookClient({ onUnauthenticated });
  let selected: ContainerIdentity | null | undefined, config: WebhookConfig | null | undefined, abort: AbortController | undefined;
  let version = 0, busy = false;
  const clearSecret = () => { secretInput.value = ''; secret.hidden = true; };
  function controls() { for (const control of [input, save, remove, refresh, ...list.querySelectorAll<HTMLButtonElement>('button')]) control.disabled = busy; }
  function render(deliveries: WebhookDelivery[] = []) {
    remove.hidden = !config; save.textContent = config ? 'Save and rotate key' : 'Save webhook';
    list.replaceChildren(...deliveries.map(item => {
      const li = document.createElement('li'), label = document.createElement('span');
      label.textContent = `${item.id} · ${item.status} · ${item.attempts}/8 attempts`; li.append(label);
      if (item.status === 'exhausted' && item.manualRetries < 3) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = 'Retry delivery';
        button.setAttribute('aria-label', `Retry delivery ${item.id}`); button.onclick = () => mutate('POST', { eventId: item.id }, '/retry'); li.append(button);
      }
      return li;
    }));
  }
  async function load() {
    if (!selected || busy) return;
    const current = ++version, container = selected; abort?.abort(); abort = new AbortController(); busy = true; controls(); error.hidden = true;
    status.textContent = 'Loading webhook…';
    try {
      const [result, deliveries] = await Promise.all([request(container, 'GET', undefined, '', abort.signal), request(container, 'GET', undefined, '/deliveries', abort.signal)]);
      if (current !== version) return;
      config = result.config; input.value = config?.url ?? ''; render(deliveries); status.textContent = config ? (deliveries.length ? '' : 'No deliveries yet.') : 'No webhook configured.';
    } catch { if (current !== version) return; error.textContent = 'Could not load webhook. Refresh to try again.'; error.hidden = false; status.textContent = ''; }
    busy = false; controls();
  }
  async function mutate(method: string, body?: unknown, suffix = '') {
    if (!selected || busy) return;
    const current = ++version, container = selected; abort?.abort(); abort = new AbortController(); busy = true; controls(); error.hidden = true; clearSecret();
    status.textContent = method === 'PUT' ? 'Saving webhook…' : method === 'DELETE' ? 'Removing webhook…' : 'Retrying delivery…';
    try {
      const result = await request(container, method, body, suffix, abort.signal);
      if (current !== version) return;
      if (method === 'PUT') { const saved = result as { config: WebhookConfig; signingSecret: string }; config = saved.config; input.value = config.url; secretInput.value = saved.signingSecret; secret.hidden = false; render(); status.textContent = 'Webhook saved.'; }
      else if (method === 'DELETE') { config = null; input.value = ''; render(); status.textContent = 'Webhook removed.'; }
      else { status.textContent = 'Delivery queued. Refresh for its result.'; list.replaceChildren(); }
    } catch (caught) {
      const failure = caught instanceof Error ? caught : new Error("Unexpected error");
      if (current !== version) return;
      status.textContent = ''; error.hidden = false;
      error.textContent = failure.message === 'invalid_webhook' ? 'Use an approved HTTPS relay URL.'
        : failure.message === 'webhook_conflict' ? 'This generation is no longer running, or the delivery cannot be retried. Refresh to check.'
        : method === 'PUT' ? 'Save could not be confirmed. Refresh to check the configuration. If the key was lost, save again to rotate it.'
        : 'The action could not be confirmed. Refresh to check its result.';
    }
    busy = false; controls();
  }
  form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) mutate('PUT', { url: input.value }); };
  remove.onclick = () => mutate('DELETE'); refresh.onclick = () => load();
  host.addEventListener('toggle', () => { if (host.open && selected) load(); });
  return {
    select(container: ContainerIdentity, enabled: boolean) { version++; abort?.abort(); selected = enabled ? { ...container } : null; config = null; busy = false; clearSecret(); input.value = ''; render(); controls(); host.hidden = !enabled; host.open = false; status.textContent = ''; error.hidden = true; },
    clear() { version++; abort?.abort(); selected = null; config = null; busy = false; clearSecret(); input.value = ''; list.replaceChildren(); host.open = false; host.hidden = true; status.textContent = ''; error.hidden = true; },
  };
}
