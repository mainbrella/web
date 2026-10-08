import { API_ORIGIN, createAuthClient } from './auth.ts';
import { createPreviewClient } from './container-previews.ts';
import { launchIdentity, normalizeRepo, repoRunUrl, type RepoRunOptions, type RepositoryLaunch } from './repo-run-contract.ts';
import { repoSetupPrompt, validRepo } from './repo-run-prompt.ts';
import type { ContainerData } from './types.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('run-form');
const fields = element<HTMLFieldSetElement>('run-fields');
const status = element('run-status');
const error = element('run-error');
const submit = element<HTMLButtonElement>('run-submit');
const terminalHost = element('run-terminal');
const repo = element<HTMLInputElement>('run-repo');
const params = new URLSearchParams(location.search);
repo.value = params.get('repo') ?? '';
let identity = launchIdentity(location.hash);
// Agent-generated links retain their launch settings without manual editors.
const launchMode = Boolean(identity || params.get('catalogId') || params.get('setupCommand') || params.get('startCommand'));
let launch: RepositoryLaunch | null = null;
let userId: string | null = null;
let active = false;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let terminal: { dispose: () => void } | undefined;
let terminalClosed = false;
let previewBusy = false;
let previewExpiry = 0;
let pendingPreviewId: string | undefined;
let previewAttempted = false;
let launchedHere = false;
let stopped = false;
let sessionVersion = 0;
let logsBusy = false;
const logCache = new Map<string, { text: string; finished: boolean }>();
const messages: Record<string, string> = {
  public_repo_not_found: 'Public repository not found. Use an owner/repository name or a public GitHub URL.',
  repo_ref_not_found: 'This branch, tag, or commit was not found.',
  repo_directory_not_found: 'The working directory was not found in this repository.',
  github_rate_limited: 'GitHub is limiting repository lookups. Wait a few minutes and try again.',
  github_unavailable: 'Could not reach GitHub. Try again.',
  subscription_required: 'An active paid plan or trial is required to run a repository.',
  container_limit_exceeded: 'Your container limit has been reached. Stop a container in the dashboard, then resume this launch.',
  compute_capacity_exceeded: 'Your account has no capacity for this machine. Stop another container, then resume this launch.',
  container_quota_exceeded: 'Your monthly container start allowance has been reached.',
  compute_allowance_exhausted: 'Your compute allowance has been used.',
  image_not_available: 'This runtime is unavailable. Start a new run with another runtime.',
  launch_not_found: 'This run was not found in your account. Open the launch link to create your own run.',
  idempotency_key_conflict: 'This launch was already submitted with different settings. Open a new run to change them.',
  invalid_request: 'Check the repository, ref, directory, and preview settings. A start command and port must be supplied together.',
  cloning_failed: 'Checkout failed. Review the output; the container is available for repair.',
  setup_failed: 'Setup failed. Review the output or repair it in the terminal.',
  starting_failed: 'The app did not become ready. Check /workspace/.mainbrella-preview.log in the terminal.',
  execution_history_expired: 'Launch output has expired. Inspect the container in the terminal before starting any commands.',
  execution_reconciliation_required: 'The previous command could not be reconciled safely. Inspect the container in the terminal.',
  allocation_reconciliation_required: 'The previous allocation could not be reconciled safely. Check your dashboard.',
  container_not_running: 'This container has stopped. Start a new run to create another container.',
  creation_no_longer_running: 'This container has stopped. Start a new run to create another container.',
};
function showError(cause: unknown) {
  const code = cause instanceof Error ? cause.message : 'launch_unavailable';
  error.textContent = messages[code] ?? 'Could not confirm launch progress. Resume to check the same launch again.';
  error.hidden = false;
}
function options(): RepoRunOptions {
  return { repo: normalizeRepo(repo.value), size: params.get('size') || 'small', cwd: params.get('cwd') || '.',
    ...(params.get('ref') ? { ref: params.get('ref')! } : {}),
    ...(params.get('catalogId') ? { catalogId: params.get('catalogId')! } : {}),
    ...(params.get('setupCommand') ? { setupCommand: params.get('setupCommand')! } : {}),
    ...(params.get('startCommand') ? { startCommand: params.get('startCommand')! } : {}),
    ...(params.get('port') ? { port: Number(params.get('port')) } : {}) };
}
function submitLabel() { return 'Run repository'; }
function updatePrompt() {
  element('run-copy-step').hidden = true;
  element<HTMLButtonElement>('run-prompt-copy').disabled = true;
  submit.hidden = !launchMode;
  element('run-allowance').hidden = !launchMode;
  element('run-intro').hidden = !launchMode;
  element('run-repo-label').textContent = launchMode ? 'GitHub repository' : '1. Paste the GitHub URL';
  repo.readOnly = launchMode;
  const config = element('run-config');
  config.hidden = !launchMode;
  const value = options();
  config.textContent = [value.ref && `Ref: ${value.ref}`, `Runtime: ${value.catalogId || 'Automatic'} · Size: ${value.size}`, `Directory: ${value.cwd}`,
    value.setupCommand && `Setup: ${value.setupCommand}`, value.startCommand && `Start: ${value.startCommand}`, value.port !== undefined && `Preview port: ${value.port}`].filter(Boolean).join('\n');
}
function preparePrompt(focus = false) {
  if (launchMode || !validRepo(repo.value)) return;
  const text = element<HTMLTextAreaElement>('run-prompt-text');
  text.value = repoSetupPrompt(options(), location.origin);
  fields.hidden = true;
  element('run-prompt-preview').hidden = false;
  element('run-copy-step').hidden = false;
  element<HTMLButtonElement>('run-prompt-copy').disabled = false;
  if (focus) text.focus();
}
function validateRepo() {
  repo.setCustomValidity(validRepo(repo.value) ? '' : 'Enter a public GitHub URL or owner/repository.');
  return repo.reportValidity();
}
async function copyPrompt(existing = false) {
  if (!existing && !validateRepo()) return;
  const note = element(existing ? 'run-help-status' : 'run-prompt-status');
  const text = element<HTMLTextAreaElement>(existing ? 'run-help-text' : 'run-prompt-text');
  const button = element<HTMLButtonElement>(existing ? 'run-help-copy' : 'run-prompt-copy');
  text.value = repoSetupPrompt(existing && launch ? launch.options : options(), location.origin, existing ? launch : null);
  button.disabled = true;
  note.textContent = '';
  try {
    await navigator.clipboard.writeText(text.value);
    note.textContent = 'Copied. Paste into Codex to get your launch link.';
  } catch {
    if (existing) element<HTMLDetailsElement>('run-help-details').open = true;
    else element('run-prompt-preview').hidden = false;
    text.focus(); text.select();
    note.textContent = 'Could not copy automatically. The prompt is selected; copy it and paste into Codex.';
  } finally { button.disabled = false; }
}
function updateSignIn() {
  const url = repoRunUrl(options(), location.origin);
  url.hash = location.hash;
  element<HTMLAnchorElement>('run-sign-in').href = `/login/?returnTo=${encodeURIComponent(url.pathname + url.search + url.hash)}`;
}
function saveIdentity(kind: 'launch' | 'request', id: string) {
  const url = repoRunUrl(launch?.options ?? options(), location.origin);
  url.hash = `${kind}=${id}`;
  history.replaceState(null, '', url);
  identity = { kind, id };
  updateSignIn();
}
async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const response = await fetch(new URL(path, API_ORIGIN), { method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(65_000),
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => null);
  if (response.status === 401) { signIn(); throw new Error('not_authenticated'); }
  if (!response.ok || !result) throw Object.assign(new Error(result?.error || 'launch_unavailable'), { status: response.status });
  return result as T;
}
function signIn() {
  sessionVersion++;
  active = false; userId = null; launch = null;
  logCache.clear(); pendingPreviewId = undefined; previewExpiry = 0;
  element('run-source').textContent = ''; element('run-commit').textContent = '';
  element('run-phase').textContent = ''; element('run-log-output').textContent = '';
  element<HTMLTextAreaElement>('run-help-text').value = '';
  element('run-progress').hidden = true;
  form.hidden = false; element('run-intro').hidden = false;
  element('run-preview-open').hidden = true;
  clearTimeout(timer);
  terminal?.dispose(); terminal = undefined; terminalHost.hidden = true;
  element('run-access').hidden = false;
  element('run-sign-in').hidden = false;
  element('run-plans').hidden = true;
  element('run-access-note').textContent = 'to run this repository in your account.';
  status.textContent = '';
  submit.disabled = false;
  submit.formNoValidate = true;
  updateSignIn();
}
async function share(button: HTMLButtonElement) {
  if (!launch && !validateRepo()) return;
  try {
    await navigator.clipboard.writeText(repoRunUrl(launch?.options ?? options(), location.origin).href);
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 2000);
  } catch { error.textContent = 'Could not copy the link. Allow clipboard access and try again.'; error.hidden = false; }
}
function openTerminal() {
  if (!active || !launch?.container || launch.phase === 'stopped' || terminal) return;
  terminalHost.hidden = false;
  terminalClosed = false;
  void import('./container-terminal.ts').then(({ openContainerTerminal }) => {
    if (stopped || !active || terminal || terminalClosed || !launch?.container || launch.phase === 'stopped') return;
    terminal = openContainerTerminal(terminalHost, { ...launch.container, onClose: () => { terminal = undefined; terminalClosed = true; } });
  });
}
function render() {
  if (!launch) return;
  form.hidden = true;
  element('run-intro').hidden = true;
  status.textContent = '';
  element('run-progress').hidden = false;
  const source = element<HTMLAnchorElement>('run-source');
  source.textContent = launch.repository.repo;
  source.href = `https://github.com/${launch.repository.repo}/tree/${launch.repository.commit}`;
  element('run-commit').textContent = `${launch.repository.ref} · ${launch.repository.commit.slice(0, 12)} · ${launch.options.size}`;
  const phases = { allocating: 'Creating container…', cloning: 'Cloning repository…', setup: 'Running setup… Terminal ready.',
    starting: 'Starting app and checking readiness… Terminal ready.', ready: 'Repository ready.', failed: 'Launch needs attention.', stopped: 'Container stopped.' };
  element('run-phase').textContent = phases[launch.phase];
  element('run-help').hidden = !launch.container || !launch.shellReadyAt && launch.phase !== 'failed' || launch.phase === 'stopped';
  element<HTMLTextAreaElement>('run-help-text').value = repoSetupPrompt(launch.options, location.origin, launch);
  if (launch.error) showError(new Error(launch.error));
  element<HTMLButtonElement>('run-terminal-open').disabled = !active;
  element<HTMLButtonElement>('run-preview-create').disabled = !active;
  element('run-terminal-open').hidden = !launch.container || !launch.shellReadyAt && launch.phase !== 'failed' || launch.phase === 'stopped';
  if (launch.phase === 'stopped') { terminal?.dispose(); terminal = undefined; terminalHost.hidden = true; }
  else if (launch.shellReadyAt && !terminalClosed) openTerminal();
  element('run-preview').hidden = !launch.previewReadyAt || launch.phase === 'stopped';
  if (launch.phase === 'failed') element<HTMLDetailsElement>('run-logs').open = true;
}
async function logs() {
  if (!launch?.container || logsBusy || !element<HTMLDetailsElement>('run-logs').open) return;
  const version = sessionVersion;
  const identityQuery = new URLSearchParams({ id: launch.container.id, createdAt: launch.container.createdAt });
  const output: string[] = [];
  logsBusy = true;
  try {
    for (const [phase, id] of Object.entries(launch.executions)) {
      if (stopped || version !== sessionVersion) return;
      let cached = logCache.get(id);
      if (!cached?.finished) {
        try {
          const execution = await request<{ stdout: string; stderr: string; status: string }>(`/containers/executions/${id}?${identityQuery}`);
          if (stopped || version !== sessionVersion) return;
          cached = { text: `${phase} · ${execution.status}\n${execution.stdout}${execution.stderr}`, finished: !['starting', 'running'].includes(execution.status) };
          logCache.set(id, cached);
        } catch { cached = { text: `${phase} · Output unavailable or expired.`, finished: false }; }
      }
      output.push(cached.text);
    }
    if (!stopped && version === sessionVersion) element('run-log-output').textContent = output.join('\n\n') || 'Output will appear here.';
  } finally { logsBusy = false; }
}
async function advance() {
  if (!launch || busy || stopped) return;
  const version = sessionVersion;
  busy = true;
  element('run-retry').hidden = true;
  error.hidden = true;
  try {
    const state = await request<RepositoryLaunch>(`/repo-launches/${launch.id}/advance`, 'POST');
    if (stopped || version !== sessionVersion) return;
    launch = state;
    render();
    if (launchedHere && launch.previewReadyAt && !previewAttempted) { previewAttempted = true; void createPreview(); }
    await logs();
    if (stopped || version !== sessionVersion || !launch) return;
    if (!['ready', 'failed', 'stopped'].includes(launch.phase)) timer = setTimeout(advance, 2000);
  } catch (cause) {
    if (stopped || version !== sessionVersion) return;
    showError(cause);
    element('run-retry').hidden = false;
  } finally { busy = false; }
}
async function run() {
  if (!userId) {
    updateSignIn();
    location.href = element<HTMLAnchorElement>('run-sign-in').href;
    return;
  }
  if (busy || !active || stopped) return;
  const version = sessionVersion;
  const value = options();
  if (Boolean(value.startCommand) !== (value.port !== undefined)) {
    error.textContent = 'This launch link needs both a start command and preview port. Ask Codex for a corrected link.';
    error.hidden = false; return;
  }
  if (!form.reportValidity()) return;
  busy = true;
  launchedHere = true;
  submit.disabled = true; fields.disabled = true;
  error.hidden = true;
  status.textContent = 'Validating repository…';
  if (!identity || identity.kind !== 'request') saveIdentity('request', crypto.randomUUID());
  try {
    const state = await request<RepositoryLaunch>('/repo-launches', 'POST', value, identity!.id);
    if (stopped || version !== sessionVersion) return;
    launch = state;
    saveIdentity('launch', launch.id);
    render();
  } catch (cause) {
    if (!stopped && version === sessionVersion) {
      status.textContent = ''; showError(cause); submit.textContent = 'Resume launch';
      if ([400, 402, 413, 429].includes((cause as { status?: number }).status ?? 0)) {
        identity = null; history.replaceState(null, '', repoRunUrl(options(), location.origin));
        fields.disabled = false; submit.textContent = submitLabel();
      }
    }
  } finally { busy = false; submit.disabled = Boolean(userId) && !active; }
  if (launch && !stopped) void advance();
}
const previewRequest = createPreviewClient({ onUnauthenticated: signIn });
async function createPreview() {
  if (!active || !launch?.container || !launch.options.port || previewBusy) return;
  const version = sessionVersion;
  previewBusy = true;
  const button = element<HTMLButtonElement>('run-preview-create');
  const note = element('run-preview-status');
  const link = element<HTMLAnchorElement>('run-preview-open');
  button.disabled = true; link.hidden = true;
  note.textContent = 'Creating preview link…';
  try {
    // Reconcile one-time URLs, including a grant left by an uncertain response.
    if (pendingPreviewId) {
      await previewRequest(launch.container, 'DELETE', pendingPreviewId);
      pendingPreviewId = undefined;
      if (stopped || version !== sessionVersion) return;
    }
    const grants = await previewRequest(launch.container);
    if (stopped || version !== sessionVersion) return;
    for (const grant of grants.filter(item => item.port === launch!.options.port)) {
      if (stopped || version !== sessionVersion) return;
      await previewRequest(launch.container, 'DELETE', grant.id);
    }
    if (stopped || version !== sessionVersion) return;
    const grant = await previewRequest(launch.container, 'POST', launch.options.port);
    if (stopped || version !== sessionVersion) return;
    link.href = grant.url!; link.hidden = false; previewExpiry = grant.expiresAt;
    button.textContent = 'Renew preview link';
    note.textContent = `Link expires at ${new Date(grant.expiresAt).toLocaleTimeString()}. Anyone with the URL can access this app. Cookies are unsupported.`;
    previewAttempted = true;
  } catch (cause) {
    if (stopped || version !== sessionVersion) return;
    pendingPreviewId = (cause as { previewId?: string }).previewId ?? pendingPreviewId;
    previewAttempted = true;
    note.textContent = cause instanceof Error && cause.message === 'container_not_running'
      ? 'Container stopped. Start a new run.' : 'Could not issue the link. Retry to reconcile existing grants and create a new link.';
  } finally { previewBusy = false; button.disabled = !active; }
}
async function init() {
  const version = ++sessionVersion;
  error.hidden = true;
  element('run-retry').hidden = true;
  if (!launch) element('run-progress').hidden = true;
  status.textContent = 'Checking your session…';
  updateSignIn();
  if (identity?.kind === 'request') { fields.disabled = true; submit.textContent = 'Resume launch'; }
  try {
    const session = await createAuthClient().readSession();
    if (stopped || version !== sessionVersion) return;
    if (!session) { signIn(); return; }
    userId = session.user.id;
    submit.formNoValidate = false;
    const data = await request<ContainerData>('/containers');
    if (stopped || version !== sessionVersion) return;
    active = data.active;
    submit.disabled = !active;
    element('run-access').hidden = active;
    element('run-sign-in').hidden = true;
    element('run-plans').hidden = active;
    element('run-access-note').textContent = 'or activate a trial to run this repository.';
    status.textContent = '';
    if (data.active) element('run-allowance').textContent = `${Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts)} starts remaining this month. Each run uses your account’s compute allowance.`;
    if (identity?.kind === 'launch') {
      const state = await request<RepositoryLaunch>(`/repo-launches/${identity.id}`);
      if (stopped || version !== sessionVersion) return;
      launch = state;
      render();
      if (active) void advance();
    }
  } catch (cause) { if (stopped || version !== sessionVersion) return; showError(cause); status.textContent = ''; element('run-retry').hidden = false; element('run-progress').hidden = false; }
}
form.addEventListener('submit', event => { event.preventDefault(); if (launchMode) void run(); else { preparePrompt(); void copyPrompt(); } });
form.addEventListener('input', event => {
  repo.setCustomValidity(''); element('run-prompt-status').textContent = '';
  if (launchMode) updateSignIn();
  else if (event.target === repo && (event as InputEvent).inputType === 'insertFromPaste') preparePrompt(true);
});
repo.addEventListener('change', () => { preparePrompt(true); });
element('run-help-copy').onclick = () => { void copyPrompt(true); };
for (const id of ['run-active-share']) element<HTMLButtonElement>(id).onclick = event => { void share(event.currentTarget as HTMLButtonElement); };
element('run-retry').onclick = () => { if (launch) void advance(); else void init(); };
element('run-terminal-open').onclick = openTerminal;
element('run-preview-create').onclick = () => { void createPreview(); };
element('run-logs').addEventListener('toggle', () => { void logs(); });
const expiryTimer = setInterval(() => {
  if (previewExpiry && previewExpiry <= Date.now()) { element('run-preview-open').hidden = true; element('run-preview-status').textContent = 'Preview link expired. Renew it to open the app again.'; previewExpiry = 0; }

}, 1000);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); clearInterval(expiryTimer); terminal?.dispose(); });
window.addEventListener('auth-change', () => { if (!launchMode) return; stopped = true; signIn(); element('run-progress').hidden = true; });
window.addEventListener('cookie-consent-change', event => {
  if (!launchMode) return;
  if ((event as CustomEvent).detail?.choice === 'accepted') { stopped = false; void init(); }
  else { stopped = true; signIn(); element('run-progress').hidden = true; }
});
updatePrompt();
preparePrompt();
if (launchMode) void init();
