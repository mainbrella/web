import { API_ORIGIN, createAuthClient } from './auth.ts';
import { normalizeRepo, validRepo, type RepoRunOptions } from './repo-run-contract.ts';

const panel = document.getElementById('run-github')!;
const note = document.getElementById('run-github-status')!;
const repo = document.getElementById('run-repo') as HTMLInputElement;
const connect = document.getElementById('run-github-connect') as HTMLButtonElement;
const check = document.getElementById('run-github-check') as HTMLButtonElement;
const disconnect = document.getElementById('run-github-disconnect') as HTMLButtonElement;
let busy = false, reauthorize = false, generation = 0;
const errors: Record<string, string> = {
  github_connection_required: 'Connect GitHub to grant read-only access to this repository.',
  github_repository_access_required: 'GitHub could not grant access. Check the URL and select this repository in the Import app installation. An organization owner may need to approve it.',
  github_import_unavailable: 'Private repository connections are temporarily unavailable. Try again or contact support@mainbrella.com.',
  github_connection_busy: 'GitHub authorization is being refreshed. Wait a moment and check access again.',
  github_rate_limited: 'GitHub is limiting requests. Wait a few minutes and check access again.',
  github_access_denied: 'GitHub denied access. Check your repository selection and organization approval.',
};
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, API_ORIGIN), { method, credentials: 'include', redirect: 'error',
    signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? 'github_unavailable');
  return data;
}
async function signedIn() {
  const session = await createAuthClient().readSession();
  if (session) return true;
  const destination = new URL(location.href);
  destination.searchParams.set('repo', normalizeRepo(repo.value)); destination.searchParams.set('private', '1');
  destination.searchParams.delete('github');
  location.href = `/login/?returnTo=${encodeURIComponent(destination.pathname + destination.search + destination.hash)}`;
  return false;
}
function showError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  reauthorize = message === 'github_connection_required';
  if (reauthorize) connect.textContent = 'Reconnect GitHub';
  note.textContent = errors[message] ?? 'Could not finish connecting this repository. Check the URL and try again.';
}
async function operate(action: (version: number) => Promise<void>) {
  if (busy) return;
  const version = generation;
  busy = true; connect.disabled = true; check.disabled = true; disconnect.disabled = true;
  try { await action(version); } catch (error) { if (version === generation) showError(error); }
  finally { busy = false; connect.disabled = false; check.disabled = false; disconnect.disabled = false; }
}
async function prepare(version: number) {
  if (!validRepo(repo.value)) { note.textContent = 'Enter a GitHub URL or owner/repository first.'; repo.focus(); return; }
  if (!await signedIn() || version !== generation) return;
  const currentRepo = normalizeRepo(repo.value);
  note.textContent = 'Checking repository access and detecting setup…';
  const query = new URLSearchParams({ repo: currentRepo });
  const result = await request<{ private?: boolean; repo: string; commit: string; suggestedConfiguration?: RepoRunOptions }>(`/repo-launches/resolve?${query}`);
  if (version !== generation || normalizeRepo(repo.value) !== currentRepo) return;
  reauthorize = false;
  disconnect.hidden = !result.private;
  connect.textContent = 'Change repository access';
  note.textContent = result.private
    ? 'Private repository access granted. Review the detected setup below. It opens a terminal; use a coding agent with repository access to add a web start command if needed.'
    : 'This repository is public. You can continue without a GitHub connection.';
  window.dispatchEvent(new CustomEvent('github-repository-ready', { detail: result }));
}
connect.onclick = () => void operate(async version => {
  if (!validRepo(repo.value)) { note.textContent = 'Enter a GitHub URL or owner/repository first.'; repo.focus(); return; }
  if (!await signedIn() || version !== generation) return;
  note.textContent = 'Opening GitHub authorization…';
  const destination = new URL(location.href); destination.searchParams.delete('github'); destination.searchParams.set('private', '1');
  const result = await request<{ url: string }>('/github/import/connect', 'POST', { repo: normalizeRepo(repo.value),
    returnTo: destination.pathname + destination.search + destination.hash, reauthorize });
  const next = new URL(result.url);
  if (next.origin !== 'https://github.com') throw new Error('github_unavailable');
  if (version === generation) location.href = next.href;
});
check.onclick = () => void operate(prepare);
disconnect.onclick = () => void operate(async version => {
  await request('/github/import/connection', 'DELETE');
  if (version !== generation) return;
  disconnect.hidden = true; connect.textContent = 'Connect GitHub'; reauthorize = true;
  note.textContent = 'GitHub connection removed. Existing checkouts remain in your machines and saved workspaces. Manage installations on GitHub to revoke the app’s repository access.';
});
window.addEventListener('github-access-required', event => {
  panel.hidden = false; showError(new Error((event as CustomEvent).detail));
});
window.addEventListener('auth-change', () => { generation++; disconnect.hidden = true; note.textContent = 'Sign in to connect a private repository.'; });
repo.addEventListener('input', () => { generation++; disconnect.hidden = true; note.textContent = 'Connect the Import app, then check access for this repository.'; });
window.addEventListener('pagehide', () => { generation++; });
const params = new URLSearchParams(location.search);
if (params.get('private') === '1' || params.has('github')) {
  panel.hidden = false;
  if (params.get('github') === 'connected') void operate(prepare);
  else if (params.get('github') === 'approval_pending') note.textContent = 'Installation requested. Ask your organization owner to approve it, then check access again.';
  else if (params.get('github') === 'cancelled') note.textContent = 'GitHub connection cancelled. Connect again when you are ready.';
  else if (params.has('github')) showError(new Error(params.get('github')!));
}
