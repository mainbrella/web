import { API_ORIGIN } from './platform.ts';
import type { ClientOptions } from './container-types.ts';

export interface SandboxSecret { id: string; name: string; hostname: string; header: string; prefix: string; createdAt: string; updatedAt: string }
export interface SecurityCapabilities { internetControl?: boolean; egressPolicies?: boolean; secrets?: boolean }

export function secretMetadata(input: unknown): SandboxSecret {
  const value = input as SandboxSecret | null;
  if (!value || typeof value.id !== 'string' || !/^sec_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)
    || typeof value.name !== 'string' || typeof value.hostname !== 'string' || typeof value.header !== 'string'
    || typeof value.prefix !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('invalid_response');
  return { id: value.id, name: value.name, hostname: value.hostname, header: value.header, prefix: value.prefix, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function networkSettings(mode: string, allow: string, deny: string, bindings: string[], capabilities: SecurityCapabilities) {
  if (mode === 'blocked') {
    if (!capabilities.internetControl) throw new Error('network_unavailable');
    return { internet: false };
  }
  if (mode === 'restricted') {
    if (!capabilities.egressPolicies) throw new Error('network_unavailable');
    const rules = (value: string) => [...new Set(value.split(/[\s,]+/).map(rule => rule.trim()).filter(Boolean))];
    const allowed = rules(allow), denied = rules(deny);
    if (!allowed.length || allowed.length > 64 || denied.length > 64) throw new Error('invalid_network_rules');
    if (bindings.length > 16 || (bindings.length && !capabilities.secrets)) throw new Error('invalid_secret_bindings');
    return { networkPolicy: { allow: allowed, ...(denied.length ? { deny: denied } : {}) }, ...(bindings.length ? { secretBindings: bindings } : {}) };
  }
  if (mode !== 'unrestricted') throw new Error('invalid_network_rules');
  return {};
}

export function createSecretsClient({ fetcher = fetch, onUnauthenticated }: ClientOptions = {}) {
  return async (method = 'GET', id?: string, body?: unknown) => {
    const response = await fetcher(`${API_ORIGIN}/secrets${id ? `/${encodeURIComponent(id)}` : ''}`, {
      method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) onUnauthenticated?.();
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'secrets_unavailable');
    if (method === 'GET') {
      if (!Array.isArray(result?.secrets)) throw new Error('invalid_response');
      return result.secrets.map(secretMetadata) as SandboxSecret[];
    }
    return [];
  };
}

export function createSandboxSecurity({ onUnauthenticated }: Pick<ClientOptions, 'onUnauthenticated'>) {
  const host = document.querySelector<HTMLElement>('#sandbox-secrets')!;
  const rows = host.querySelector<HTMLElement>('ul')!;
  const status = host.querySelector<HTMLElement>('[role="status"]')!;
  const error = host.querySelector<HTMLElement>('[role="alert"]')!;
  const dialog = document.querySelector<HTMLDialogElement>('#sandbox-secret-dialog')!;
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const title = dialog.querySelector<HTMLElement>('h2')!;
  const fields = dialog.querySelector<HTMLFieldSetElement>('fieldset')!;
  const name = dialog.querySelector<HTMLInputElement>('#sandbox-secret-name')!;
  const hostname = dialog.querySelector<HTMLInputElement>('#sandbox-secret-host')!;
  const header = dialog.querySelector<HTMLSelectElement>('#sandbox-secret-header')!;
  const prefix = dialog.querySelector<HTMLInputElement>('#sandbox-secret-prefix')!;
  const value = dialog.querySelector<HTMLInputElement>('#sandbox-secret-value')!;
  const dialogError = dialog.querySelector<HTMLElement>('[role="alert"]')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const launchSettings = document.querySelector<HTMLDetailsElement>('#sandbox-network-settings')!;
  const mode = launchSettings.querySelector<HTMLSelectElement>('select')!;
  const policy = launchSettings.querySelector<HTMLElement>('[data-network-policy]')!;
  const allow = launchSettings.querySelector<HTMLTextAreaElement>('#sandbox-network-allow')!;
  const deny = launchSettings.querySelector<HTMLTextAreaElement>('#sandbox-network-deny')!;
  const bindingHost = launchSettings.querySelector<HTMLElement>('[data-secret-bindings]')!;
  const bindingList = bindingHost.querySelector<HTMLElement>('[data-binding-list]')!;
  const request = createSecretsClient({ onUnauthenticated });
  let capabilities: SecurityCapabilities = {}, secrets: SandboxSecret[] = [];
  let active = false, loaded = false, busy = false, externalBusy = false, disposed = false, version = 0;
  let selected: SandboxSecret | null = null;

  function controls() {
    host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || externalBusy || (button.dataset.requiresVault === 'true' && !capabilities.secrets); });
    host.querySelector<HTMLButtonElement>('[data-secrets-new]')!.disabled = busy || externalBusy || !capabilities.secrets;
    submit.disabled = busy || externalBusy;
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(control => { control.disabled = busy; });
    fields.disabled = selected !== null || busy;
    launchSettings.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach(control => { control.disabled = externalBusy || disposed; });
  }
  function renderBindings() {
    const checked = new Set([...bindingList.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value));
    bindingList.replaceChildren(...secrets.map(secret => {
      const label = document.createElement('label'); label.className = 'secret-binding';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = secret.id; checkbox.checked = checked.has(secret.id);
      const text = document.createElement('span'); text.textContent = `${secret.name} · ${secret.hostname}`;
      label.append(checkbox, text); return label;
    }));
    if (!secrets.length) { const note = document.createElement('p'); note.className = 'dashboard-status'; note.textContent = loaded ? 'No secrets saved. Add one in the Secrets tab.' : 'Open the Secrets tab to load available secrets.'; bindingList.append(note); }
    controls();
  }
  function render() {
    rows.replaceChildren(...secrets.map(secret => {
      const row = document.createElement('li'); row.className = 'container-row';
      const details = document.createElement('div'), name = document.createElement('strong'), metadata = document.createElement('p');
      name.textContent = secret.name; metadata.className = 'dashboard-status'; metadata.textContent = `${secret.hostname} · ${secret.header}`; details.append(name, metadata);
      const actions = document.createElement('div'); actions.className = 'container-actions';
      const rotate = document.createElement('button'); rotate.type = 'button'; rotate.className = 'dashboard-retry'; rotate.textContent = 'Rotate'; rotate.dataset.requiresVault = 'true'; rotate.setAttribute('aria-label', `Rotate ${secret.name}`); rotate.onclick = () => open(secret);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'dashboard-retry button-danger'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${secret.name}`);
      remove.onclick = async () => {
        if (busy || externalBusy || !window.confirm(`Delete ${secret.name}? Containers using this secret will lose access to the credential.`)) return;
        busy = true; controls(); error.hidden = true;
        try { await request('DELETE', secret.id); if (disposed) return; loaded = false; }
        catch { if (!disposed) { error.textContent = 'Delete could not be confirmed. Refresh to check this secret.'; error.hidden = false; } }
        finally { busy = false; controls(); }
        if (!loaded) await load();
      };
      actions.append(rotate, remove); row.append(details, actions); return row;
    }));
    status.textContent = !capabilities.secrets ? 'Saving and rotating secrets is unavailable in this environment.' : secrets.length ? '' : "You haven't saved any sandbox secrets.";
    renderBindings();
  }
  async function load() {
    if (busy || disposed) return;
    busy = true; const current = ++version; controls(); status.textContent = 'Loading secrets…'; error.hidden = true;
    try { const result = await request(); if (disposed || current !== version) return; secrets = result; loaded = true; render(); }
    catch { if (!disposed && current === version) { status.textContent = ''; error.textContent = 'Could not load secrets. Refresh to try again.'; error.hidden = false; } }
    finally { busy = false; controls(); }
  }
  function open(secret: SandboxSecret | null) {
    if (busy || externalBusy || disposed) return;
    selected = secret; title.textContent = secret ? `Rotate ${secret.name}` : 'New sandbox secret';
    name.value = secret?.name ?? ''; hostname.value = secret?.hostname ?? ''; header.value = secret?.header ?? 'authorization'; prefix.value = secret?.prefix ?? 'Bearer ';
    fields.hidden = Boolean(secret); value.value = ''; dialogError.hidden = true; submit.textContent = secret ? 'Rotate secret' : 'Save secret';
    controls(); dialog.showModal(); (secret ? value : name).focus();
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || externalBusy || !form.reportValidity()) return;
    busy = true; controls(); dialogError.hidden = true; submit.textContent = 'Saving…';
    const secretValue = value.value; value.value = '';
    try {
      await request(selected ? 'PUT' : 'POST', selected?.id, selected ? { value: secretValue }
        : { name: name.value.trim(), value: secretValue, hostname: hostname.value.trim(), header: header.value, prefix: prefix.value });
      if (disposed) return;
      dialog.close(); loaded = false;
    } catch (caught) {
      if (disposed) return;
      const code = caught instanceof Error ? caught.message : '';
      dialogError.textContent = code.startsWith('invalid_') ? 'Check the name, hostname, header, and secret value. Enter the value again to retry.'
        : 'Save could not be confirmed. Refresh the secret list before retrying. Secret values are never returned.';
      dialogError.hidden = false;
      if (!dialog.open) { error.textContent = dialogError.textContent; error.hidden = false; }
    } finally { busy = false; submit.textContent = selected ? 'Rotate secret' : 'Save secret'; controls(); }
    if (!loaded) await load();
  };
  host.querySelector<HTMLButtonElement>('[data-secrets-new]')!.onclick = () => open(null);
  host.querySelector<HTMLButtonElement>('[data-secrets-refresh]')!.onclick = () => load();
  dialog.querySelector<HTMLButtonElement>('[data-secret-close]')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { value.value = ''; });
  function changeMode() {
    policy.hidden = mode.value !== 'restricted'; allow.required = mode.value === 'restricted';
    bindingHost.hidden = mode.value !== 'restricted' || !capabilities.secrets;
    if (mode.value === 'restricted' && capabilities.secrets && !loaded) load();
  }
  mode.onchange = changeMode;
  return {
    configure(next: SecurityCapabilities) {
      capabilities = next;
      launchSettings.hidden = !next.internetControl && !next.egressPolicies;
      mode.querySelector<HTMLOptionElement>('[value="blocked"]')!.disabled = !next.internetControl;
      mode.querySelector<HTMLOptionElement>('[value="restricted"]')!.disabled = !next.egressPolicies;
      // Keep a user's selection when support changes; fail closed at submission.
      changeMode();
      if (active && !loaded) load();
      if (!next.secrets) status.textContent = 'Saving and rotating secrets is unavailable in this environment.';
      controls();
    },
    creationSettings() {
      return networkSettings(mode.value, allow.value, deny.value, [...bindingList.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value), capabilities);
    },
    setVisible(visible: boolean) { active = visible; host.hidden = !visible; if (visible && !loaded) load(); },
    setBusy(next: boolean) { externalBusy = next; controls(); },
    dispose() { disposed = true; version++; value.value = ''; secrets = []; dialog.close(); rows.replaceChildren(); bindingList.replaceChildren(); },
  };
}
