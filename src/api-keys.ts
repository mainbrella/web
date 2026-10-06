interface ApiKey { id: string; name: string; prefix: string; created_at: string; last_used_at?: string }

import { API_ORIGIN, createAuthClient } from './auth.ts';

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const content = document.querySelector<HTMLElement>('#keys-content')!;
const status = document.querySelector<HTMLElement>('#keys-status')!;
const error = document.querySelector<HTMLElement>('#keys-error')!;
const retry = document.querySelector<HTMLButtonElement>('#keys-retry')!;
const form = document.querySelector<HTMLFormElement>('#key-form')!;
const name = document.querySelector<HTMLInputElement>('#key-name')!;
const create = document.querySelector<HTMLButtonElement>('#key-create')!;
const list = document.querySelector<HTMLElement>('#key-list')!;
const empty = document.querySelector<HTMLElement>('#keys-empty')!;
const secret = document.querySelector<HTMLElement>('#key-secret')!;
const token = document.querySelector<HTMLTextAreaElement>('#key-token')!;
const copy = document.querySelector<HTMLButtonElement>('#key-copy')!;
const dismiss = document.querySelector<HTMLButtonElement>('#key-dismiss')!;
const copyStatus = document.querySelector<HTMLElement>('#key-copy-status')!;
let keys: ApiKey[] = [];
let busy = false;
let disposed = false;

function clearSecret() {
  token.value = '';
  secret.hidden = true;
  copyStatus.textContent = '';
}

function goToLogin() {
  disposed = true;
  clearSecret();
  content.hidden = true;
  window.location.replace('/login/?returnTo=%2Fapi-keys%2F');
}

function controls() {
  name.disabled = busy || disposed;
  create.disabled = busy || disposed || keys.length >= 20 || !secret.hidden;
  retry.disabled = busy || disposed;
  list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || disposed; });
  main.setAttribute('aria-busy', String(busy));
}

async function request(method = 'GET', id?: string) {
  const url = new URL(`${API_ORIGIN}/api-keys`);
  if (id) url.searchParams.set('id', id);
  const response = await fetch(url, {
    method, credentials: 'include',
    headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ name: name.value.trim() }) } : {}),
  });
  if (response.status === 401) {
    goToLogin();
    throw new Error('Your session has expired. Please sign in again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error === 'api_key_limit'
    ? 'You can have up to 20 keys. Revoke an unused key before creating another.'
    : method === 'POST' ? 'Could not create the key. Please try again.'
    : method === 'DELETE' ? 'Could not revoke the key. Please try again.'
    : 'Could not load your API keys. Please try again.');
  return data;
}

function render() {
  list.replaceChildren();
  empty.hidden = keys.length !== 0;
  keys.forEach(key => {
    const row = document.createElement('li');
    row.className = 'container-row key-row';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = key.name;
    const metadata = document.createElement('p');
    metadata.className = 'dashboard-status key-metadata';
    metadata.textContent = `${key.prefix}… · Created ${new Date(key.created_at).toLocaleDateString()} · ${key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}` : 'Never used'}`;
    details.append(title, metadata);
    const revoke = document.createElement('button');
    revoke.className = 'dashboard-retry key-revoke';
    revoke.type = 'button';
    revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', `Revoke ${key.name}`);
    revoke.addEventListener('click', async () => {
      if (busy || !window.confirm(`Revoke “${key.name}”? Applications using this key will lose API access.`)) return;
      busy = true;
      error.hidden = true;
      controls();
      try {
        await request('DELETE', key.id);
        if (disposed) return;
        keys = keys.filter(item => item.id !== key.id);
        render();
        status.textContent = 'Key revoked.';
        status.hidden = false;
        create.focus();
      } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
        showError(cause, 'Could not revoke the key. Check your connection and try again.');
      } finally {
        busy = false;
        controls();
      }
    });
    row.append(details, revoke);
    list.append(row);
  });
}

function showError(cause: unknown, fallback: string) {
  if (disposed) return;
  error.textContent = cause instanceof Error && !(cause instanceof TypeError) ? cause.message : fallback;
  error.hidden = false;
}

async function load() {
  if (busy || disposed) return;
  busy = true;
  controls();
  error.hidden = true;
  retry.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading API keys…';
  try {
    const session = await auth.readSession();
    if (disposed) return;
    if (!session?.user) { goToLogin(); return; }
    const data = await request();
    if (disposed) return;
    if (!Array.isArray(data.keys)) throw new Error('Could not load your API keys. Please try again.');
    keys = data.keys;
    render();
    content.hidden = false;
    status.hidden = true;
  } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
    status.hidden = true;
    showError(cause, 'Could not load your API keys. Check your connection and try again.');
    retry.hidden = false;
  } finally {
    busy = false;
    controls();
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || !secret.hidden || keys.length >= 20) return;
  if (!name.value.trim()) { name.setCustomValidity('Enter a name for this key.'); name.reportValidity(); return; }
  busy = true;
  error.hidden = true;
  status.hidden = true;
  create.textContent = 'Creating…';
  controls();
  try {
    const data = await request('POST');
    if (disposed) return;
    if (!data.key || typeof data.token !== 'string') throw new Error('Could not read the new key. Refresh the list and revoke it before trying again.');
    keys.unshift(data.key);
    render();
    name.value = '';
    token.value = data.token;
    secret.hidden = false;
    token.focus();
    token.select();
  } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
    showError(cause, 'Could not create the key. Check your connection and try again.');
  } finally {
    busy = false;
    create.textContent = 'Create key';
    controls();
  }
});
name.addEventListener('input', () => name.setCustomValidity(''));
copy.addEventListener('click', async () => {
  const value = token.value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    if (!disposed && token.value === value) copyStatus.textContent = 'Key copied.';
  } catch {
    if (disposed || token.value !== value) return;
    token.focus();
    token.select();
    copyStatus.textContent = 'Select and copy the key manually.';
  }
});
dismiss.addEventListener('click', () => { clearSecret(); controls(); name.focus(); });
retry.addEventListener('click', load);
window.addEventListener('auth-change', event => { if (event.detail?.user === null) goToLogin(); });
window.addEventListener('pagehide', clearSecret);
load();
