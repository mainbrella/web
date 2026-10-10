import { API_ORIGIN, createAuthClient } from './auth.ts';
import { createPreviewClient } from './container-previews.ts';
import { launchIdentity, normalizeRepo, repoRunUrl, type RepoRunDiagnostics, type RepoRunExecutionDiagnostics, type RepoRunOptions, type RepositoryLaunch } from './repo-run-contract.ts';
import { repoSetupPrompt, validRepo } from './repo-run-prompt.ts';
import { parseRepoRunConfig, stringifyRepoRunConfig, validateRepoRunConfig } from './repo-run-config.ts';
import { streamRunOutput, type RunOutputStatus } from './repo-run-output.ts';
import type { ContainerData } from './types.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('run-form');
const fields = element<HTMLFieldSetElement>('run-fields');
const status = element('run-status');
const error = element('run-error');
const submit = element<HTMLButtonElement>('run-submit');
const terminalHost = element('run-terminal');
const repo = element<HTMLInputElement>('run-repo');
const configInput = element<HTMLTextAreaElement>('run-import-text');
const params = new URLSearchParams(location.search);
let identity = launchIdentity(location.hash);
// Existing configured links remain supported; new configurations stay in this tab.
const legacyMode = Boolean(params.get('catalogId') || params.get('setupCommand') || params.get('startCommand'));
let configId = /^#config=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(location.hash)?.[1];
let imported: RepoRunOptions | null = null;
if (configId || identity?.kind === 'request' && !params.get('repo')) {
  configId ??= identity!.id;
  try { imported = validateRepoRunConfig(JSON.parse(sessionStorage.getItem(`mainbrella:repo-run:${configId}`) ?? 'null')); } catch { /* Offer reimport when this tab no longer has its draft. */ }
}
repo.value = imported?.repo ?? params.get('repo') ?? '';
if (imported) configInput.value = stringifyRepoRunConfig(imported);
let launchMode = Boolean(identity || legacyMode || imported);
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
let promptCopied = false;
let preparedRepo = repo.value;
let promptVersion = 0;
let logsBusy = false;
let progressPaused = false;
let phaseObservedAt = Date.now();
let progressCheckedAt = 0;
let previewError = false;
const logOutput = element<HTMLTextAreaElement>('run-log-output');
const followOutput = element<HTMLInputElement>('run-output-follow');
type ExecutionDiagnostics = RepoRunExecutionDiagnostics & { stdout: string; stderr: string; startedAt?: string; finishedAt?: string; cursor?: number };
type CachedExecution = { finished: boolean; diagnostics?: ExecutionDiagnostics; phase: string; checkedAt: number; changedAt: number; unavailable?: boolean };
const logCache = new Map<string, CachedExecution>();
type OutputStream = { controller?: AbortController; text: string; cursor: number; complete: boolean; disconnected: boolean };
const outputStreams = new Map<string, OutputStream>();
let outputRenderQueued = false;
const phaseDetails: Record<string, { label: string; deadline: string; timeoutMs: number }> = {
  cloning: { label: 'Repository clone', deadline: '5 minutes', timeoutMs: 300_000 },
  setup: { label: 'Setup', deadline: '15 minutes', timeoutMs: 900_000 },
  starting: { label: 'App startup', deadline: '4 minutes', timeoutMs: 240_000 },
};
function executionSummary(phase: string, execution: ExecutionDiagnostics) {
  const details = phaseDetails[phase] ?? { label: phase, deadline: 'the phase deadline' };
  const status = execution.status;
  let outcome: string;
  if (execution.timedOut || status === 'timed_out') outcome = `${details.label} timed out after ${details.deadline}`;
  else if (execution.exitCode === 124) outcome = `${details.label} command reported a timeout`;
  else if (execution.outputTruncated || status === 'output_limit') outcome = `${details.label} reached the output limit`;
  else if (status === 'interrupted') outcome = `${details.label} was interrupted`;
  else if (status === 'canceled') outcome = `${details.label} was canceled`;
  else if (execution.exitCode !== null && execution.exitCode !== 0) outcome = `${details.label} failed`;
  else if (status === 'failed') outcome = `${details.label} failed`;
  else outcome = `${details.label} ${status}`;
  const exitCode = execution.exitCode === null ? 'unknown' : String(execution.exitCode);
  return `${outcome} · exit code ${exitCode}`;
}
function executionText(phase: string, execution: ExecutionDiagnostics, streamed?: string) {
  const lines = [`${phase} · ${execution.status}`, executionSummary(phase, execution)];
  if (execution.outputTruncated || execution.status === 'output_limit') lines.push('Warning: output was truncated.');
  if (streamed !== undefined) lines.push(streamed);
  else {
    if (execution.stdout) lines.push(`stdout:\n${execution.stdout}`);
    if (execution.stderr) lines.push(`stderr:\n${execution.stderr}`);
  }
  return lines.join('\n');
}
function failedExecution(execution: ExecutionDiagnostics) {
  const status = execution.status;
  return Boolean(execution.timedOut || execution.outputTruncated || execution.exitCode !== undefined && execution.exitCode !== null && execution.exitCode !== 0
    || ['failed', 'timed_out', 'output_limit', 'interrupted', 'canceled'].includes(status));
}
function failureDiagnostics() {
  if (!launch) return undefined;
  const diagnostics = Object.entries(launch.executions).flatMap(([phase, id]) => {
    const entry = logCache.get(id);
    return entry?.diagnostics && failedExecution(entry.diagnostics) ? [{ ...entry, phase }] : [];
  });
  return diagnostics.at(-1);
}
function setText(id: string, text: string) {
  const node = element(id);
  if (node.textContent !== text) node.textContent = text;
}
function elapsed(since: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function reportedStage(execution?: ExecutionDiagnostics) {
  // Only explicit stage markers can establish which part of a YAML command is running.
  const markers = [...(execution?.stdout ?? '').matchAll(/^\s*(START|SUCCESS|FAILED)[:\s]+([^\r\n]{1,160})/gm)];
  const last = markers.at(-1);
  return last?.[1] === 'START' ? last[2].trim() : undefined;
}
function renderStatus() {
  if (!launch) return;
  const now = Date.now();
  const details = phaseDetails[launch.phase];
  const currentId = launch.executions[launch.phase as keyof RepositoryLaunch['executions']];
  const current = currentId ? logCache.get(currentId) : undefined;
  const execution = current?.diagnostics;
  const startedAt = execution?.startedAt ? Date.parse(execution.startedAt) : phaseObservedAt;
  const failure = failureDiagnostics();
  const previewNext = launch.options.port
    ? 'When the app responds, its preview link will be available here.'
    : 'This configuration has no web preview. The terminal will be available when setup completes.';
  let title: string, detail: string, attention = false;
  if (launch.phase === 'stopped') {
    title = 'Container stopped.';
    detail = 'This run has ended. No preview link will arrive. Start a new run to create another container.';
    attention = true;
  } else if (failure || launch.phase === 'failed') {
    title = failure ? executionSummary(failure.phase, failure.diagnostics!).split(' · ')[0] : 'Launch needs attention.';
    detail = failure ? `${executionSummary(failure.phase, failure.diagnostics!)}.` : messages[launch.error ?? ''] ?? 'The automatic launch could not continue.';
    if (failure?.diagnostics?.outputTruncated || failure?.diagnostics?.status === 'output_limit') detail = `The launcher stopped the command because captured output reached its limit (exit code ${failure.diagnostics.exitCode ?? 'unknown'}). The last package message may be normal progress.`;
    detail += ` No preview link will arrive from this launch. ${launch.container ? 'Use Copy Codex prompt below to inspect and repair this container, or open its terminal.' : 'Review the error and start a new run.'}`;
    if (failure?.phase === 'setup') detail += ' Check whether apt or dpkg is still running before retrying an installation.';
    attention = true;
  } else if (progressPaused) {
    title = 'Progress checks paused.';
    detail = 'The last progress request failed. The command may still be running, but automatic launch cannot continue until you select Resume launch. Waiting alone will not produce a preview link.';
    attention = true;
  } else if (launch.phase === 'ready') {
    if (launch.previewReadyAt) {
      title = previewBusy ? 'Creating preview link…' : previewError ? 'App ready. Preview link needs attention.' : 'App ready.';
      detail = previewBusy ? 'The app passed its HTTP readiness check. Keep waiting while we create the preview link.'
        : previewError ? 'The app passed its readiness check, but link creation failed. Select Create preview link to try again.'
          : previewExpiry ? 'Your app is responding. Open preview to use it.' : 'Your app passed its readiness check. Select Create preview link to open it.';
    } else {
      title = 'Repository ready.';
      detail = 'Setup is complete. Use the terminal to work in this repository. No web preview is configured.';
    }
    attention = previewError;
  } else {
    const titles = { allocating: 'Creating container…', cloning: 'Cloning repository…', setup: 'Running setup…', starting: 'Starting app and checking readiness…' };
    title = titles[launch.phase];
    detail = launch.phase === 'allocating' ? `Waiting for your ${launch.options.size} container to become available. The repository will be cloned next.`
      : launch.phase === 'cloning' ? `Checking out commit ${launch.repository.commit.slice(0, 12)}. Clone limit: 5 minutes.`
        : launch.phase === 'setup' ? `Running your YAML setup command. Setup limit: 15 minutes. ${previewNext}`
          : `Waiting for a successful HTTP response at / on port ${launch.options.port}. Readiness checks usually run for about 60 seconds; the startup command has a 4-minute limit. ${previewNext}`;
    const stage = reportedStage(execution);
    if (stage) detail = `Current stage: ${stage}. ${detail}`;
    const live = execution && ['starting', 'running'].includes(execution.status);
    if (current?.unavailable) {
      title = 'Output updates unavailable.';
      detail = `We cannot read the command's current output or result. We are retrying; the command may still be running. ${detail}`;
      attention = true;
    } else if ((live && current && now - current.checkedAt >= 20_000) || (progressCheckedAt && now - progressCheckedAt >= 75_000)) {
      title = 'Waiting for a progress update…';
      detail = `We cannot confirm current progress yet. A delayed response does not confirm a stuck command. ${detail}`;
      attention = true;
    } else if (live && details && Number.isFinite(startedAt) && now - startedAt >= details.timeoutMs) {
      title = `${details.label} reached its expected time limit.`;
      detail = 'Waiting for the server to confirm whether the command ended. Do not start a second installation while its result is unknown.';
      attention = true;
    } else if (live && current && now - current.changedAt >= 30_000) {
      title = `${details.label} is quiet; still checking.`;
      detail = `The command still reports ${execution.status}, but no new output has been received recently. Output can arrive in batches; silence does not confirm a hang. Keep waiting while we check its result. ${detail}`;
    } else if (execution && current?.finished) {
      detail = `${details?.label ?? 'Command'} completed. Waiting for the launcher to move to the next step. ${previewNext}`;
    }
  }
  setText('run-phase', title);
  setText('run-phase-detail', detail);
  element('run-help').hidden = !launch.container || launch.phase === 'stopped'
    || !(failure || launch.phase === 'failed' || launch.phase === 'ready' && !launch.previewReadyAt);
  element('run-state').setAttribute('data-state', attention ? 'attention' : 'normal');
  const activity: string[] = [];
  if (details && execution && Number.isFinite(startedAt)) {
    const finishedAt = execution.finishedAt ? Date.parse(execution.finishedAt) : now;
    activity.push(`${details.label} elapsed: ${elapsed(startedAt, Number.isFinite(finishedAt) ? finishedAt : now)}`);
  }
  if (current?.checkedAt) activity.push(`Result checked ${elapsed(current.checkedAt)} ago`);
  if (current && execution && !current.finished) activity.push(`Output unchanged for ${elapsed(current.changedAt)}`);
  else if (!['ready', 'failed', 'stopped'].includes(launch.phase) && progressCheckedAt) activity.push(`Progress checked ${elapsed(progressCheckedAt)} ago`);
  setText('run-activity', activity.join(' · '));
}
function renderLogs() {
  if (!launch) return;
  const text = Object.entries(launch.executions).map(([phase, id]) => {
    const entry = logCache.get(id);
    const stream = outputStreams.get(id);
    if (!entry?.diagnostics) return `${phase} · ${entry?.unavailable ? 'Output unavailable or expired.' : 'Waiting for command output…'}`;
    // A snapshot is the fallback until the ordered stream catches up to it.
    const ordered = stream && (stream.complete || stream.cursor >= (entry.diagnostics.cursor ?? Infinity)) ? stream.text : undefined;
    return executionText(phase, entry.diagnostics, ordered);
  }).join('\n\n');
  if (logOutput.value !== text) {
    const scrollTop = logOutput.scrollTop;
    logOutput.value = text;
    logOutput.scrollTop = followOutput.checked ? logOutput.scrollHeight : scrollTop;
  }
  const reconnecting = [...outputStreams.values()].some(stream => stream.disconnected && !stream.complete);
  setText('run-output-note', reconnecting
    ? 'Live output is reconnecting. Retained output and command results are still checked automatically.'
    : 'Output updates automatically. Uncheck Follow latest output to read earlier lines.');
}
function stopOutputStreams() {
  for (const stream of outputStreams.values()) stream.controller?.abort();
  outputStreams.clear();
}
function scheduleStreamRender() {
  if (outputRenderQueued) return;
  outputRenderQueued = true;
  window.requestAnimationFrame(() => {
    outputRenderQueued = false;
    if (!stopped) { renderLogs(); renderStatus(); }
  });
}
function followExecution(id: string, query: URLSearchParams) {
  const existing = outputStreams.get(id);
  if (existing?.controller || existing?.complete || stopped) return;
  const stream: OutputStream = existing ?? { text: '', cursor: 0, complete: false, disconnected: false };
  const controller = new AbortController();
  stream.controller = controller;
  outputStreams.set(id, stream);
  const version = sessionVersion;
  const isCurrent = () => !stopped && version === sessionVersion && !controller.signal.aborted;
  const url = new URL(`/containers/executions/${id}/events?${query}&cursor=${stream.cursor}`, API_ORIGIN);
  void streamRunOutput(url, AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]), (chunk, sequence) => {
    if (!isCurrent()) return;
    if (sequence <= stream.cursor) return;
    stream.cursor = sequence; stream.text += chunk; stream.disconnected = false;
    const entry = logCache.get(id);
    if (entry) entry.changedAt = Date.now();
    scheduleStreamRender();
  }, (result: RunOutputStatus) => {
    if (!isCurrent()) return;
    const entry = logCache.get(id);
    if (entry?.diagnostics) {
      entry.diagnostics = { ...entry.diagnostics, ...result };
      entry.finished = !['starting', 'running'].includes(result.status);
      entry.checkedAt = Date.now(); entry.unavailable = false;
      stream.complete = entry.finished;
    }
    scheduleStreamRender();
  }).catch(cause => {
    if (!isCurrent()) return;
    if (cause instanceof Error && cause.message === 'not_authenticated') { signIn(); return; }
    stream.disconnected = true;
  }).finally(() => { if (stream.controller === controller) stream.controller = undefined; });
}
function promptDiagnostics(): RepoRunDiagnostics {
  const result: RepoRunDiagnostics = {};
  if (launch) for (const [phase, id] of Object.entries(launch.executions)) {
    const entry = logCache.get(id);
    if (entry?.diagnostics && ['cloning', 'setup', 'starting'].includes(phase)) result[phase as 'cloning' | 'setup' | 'starting'] = {
      status: entry.diagnostics.status, exitCode: entry.diagnostics.exitCode,
      timedOut: entry.diagnostics.timedOut, outputTruncated: entry.diagnostics.outputTruncated,
    };
  }
  return result;
}
const messages: Record<string, string> = {
  public_repo_not_found: 'Public repository not found. Use an owner/repository name or a public GitHub URL.',
  repo_ref_not_found: 'This branch, tag, or commit was not found.',
  repo_directory_not_found: 'The working directory was not found in this repository.',
  github_rate_limited: 'GitHub is limiting repository lookups. Wait a few minutes and try again.',
  github_unavailable: 'Could not reach GitHub. Try again.',
  subscription_required: 'Add prepaid balance to fund this repository run.',
  spend_limit_reached: 'Available funding or your monthly spending cap is used or reserved. Add balance or adjust your cap in billing.',
  insufficient_balance: 'Add prepaid balance to fund this repository run.',
  prepaid_balance_required: 'Add prepaid balance to fund this repository run.',
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
  configuration_storage_unavailable: 'Could not save this configuration in your tab. Allow browser storage, then paste the configuration again.',
};
function showError(cause: unknown) {
  const code = cause instanceof Error ? cause.message : 'launch_unavailable';
  error.textContent = messages[code] ?? 'Could not confirm launch progress. Resume to check the same launch again.';
  error.hidden = false;
}
function options(): RepoRunOptions {
  if (imported) return { ...imported };
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
  element('run-prompt-preview').hidden = true;
  element('run-import-step').hidden = Boolean(identity) || legacyMode || (!launchMode && !promptCopied && !configId);
  element('run-access').hidden = !launchMode || Boolean(userId && active);
  status.hidden = !launchMode;
  submit.hidden = !launchMode;
  element('run-allowance').hidden = !launchMode;
  element('run-intro').hidden = !launchMode || Boolean(imported);
  element('run-repo-label').textContent = launchMode ? 'GitHub repository' : '1. Paste the GitHub URL';
  element('run-import-label').textContent = imported ? 'AI configuration' : '3. Paste AI configuration';
  repo.readOnly = launchMode;
  const config = element('run-config');
  config.hidden = !launchMode;
  const value = options();
  config.textContent = [value.ref && `Ref: ${value.ref}`, `Runtime: ${value.catalogId || 'Automatic'} · Size: ${value.size}`, `Directory: ${value.cwd}`,
    value.setupCommand && `Setup: ${value.setupCommand}`, value.startCommand && `Start: ${value.startCommand}`, value.port !== undefined && `Preview port: ${value.port}`].filter(Boolean).join('\n');
}
function configurationUrl(): URL {
  const url = imported ? new URL('/run/', location.origin) : repoRunUrl(options(), location.origin);
  if (imported && configId) url.hash = `config=${configId}`;
  return url;
}
function storeConfiguration(id: string, value: RepoRunOptions) {
  try { sessionStorage.setItem(`mainbrella:repo-run:${id}`, JSON.stringify(value)); }
  catch { throw new Error('configuration_storage_unavailable'); }
}
function importConfiguration() {
  if (identity || legacyMode || busy) return;
  const wasLaunchMode = launchMode;
  const note = element('run-import-status');
  try {
    const value = parseRepoRunConfig(configInput.value);
    const id = configId ?? crypto.randomUUID();
    storeConfiguration(id, value);
    imported = value; configId = id; launchMode = true;
    repo.value = value.repo;
    repo.setCustomValidity('');
    configInput.setAttribute('aria-invalid', 'false');
    note.textContent = 'Configuration imported. Review the commands below.';
    note.className = 'dashboard-status';
    history.replaceState(null, '', configurationUrl());
    updatePrompt(); updateSignIn();
    if (!wasLaunchMode) void init();
  } catch (cause) {
    imported = null; launchMode = false;
    configInput.setAttribute('aria-invalid', String(Boolean(configInput.value.trim())));
    note.textContent = configInput.value.trim() ? (cause instanceof Error && cause.message === 'configuration_storage_unavailable'
      ? messages.configuration_storage_unavailable : (cause as Error).message) : '';
    note.className = 'dashboard-error';
    if (configId) history.replaceState(null, '', new URL('/run/', location.origin));
    updatePrompt(); preparePrompt();
  }
}
function preparePrompt() {
  if (launchMode) return;
  if (repo.value !== preparedRepo) promptCopied = false;
  preparedRepo = repo.value;
  promptVersion++;
  const ready = validRepo(repo.value);
  const text = element<HTMLTextAreaElement>('run-prompt-text');
  text.value = ready ? repoSetupPrompt(options(), location.origin) : '';
  element('run-prompt-preview').hidden = !ready || promptCopied;
  element('run-copy-step').hidden = !ready;
  element<HTMLButtonElement>('run-prompt-copy').disabled = !ready;
  element('run-import-step').hidden = !configId && (!ready || !promptCopied);
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
  text.value = repoSetupPrompt(existing && launch ? launch.options : options(), location.origin, existing ? launch : null, existing ? promptDiagnostics() : undefined);
  const copiedVersion = promptVersion;
  const copiedRepo = repo.value;
  const copiedText = text.value;
  button.disabled = true;
  note.textContent = '';
  try {
    await navigator.clipboard.writeText(text.value);
    if (!existing && copiedVersion === promptVersion && copiedRepo === repo.value && validRepo(repo.value) && copiedText === element<HTMLTextAreaElement>('run-prompt-text').value) {
      promptCopied = true;
      element('run-import-step').hidden = false;
      element('run-prompt-preview').hidden = true;
    }
    note.textContent = existing ? 'Copied. Paste into Codex to repair this container and get reusable YAML.' : 'Paste into ChatGPT or Claude, then paste its response below.';
  } catch {
    if (existing) element<HTMLDetailsElement>('run-help-details').open = true;
    else element('run-prompt-preview').hidden = false;
    text.focus(); text.select();
    note.textContent = existing
      ? 'Could not copy automatically. The prompt is selected; copy it and paste into Codex.'
      : 'Could not copy automatically. The prompt is selected; copy it and paste into ChatGPT or Claude.';
  } finally { button.disabled = !existing && !validRepo(repo.value); }
}
function updateSignIn() {
  const url = configurationUrl();
  url.hash = location.hash;
  element<HTMLAnchorElement>('run-sign-in').href = `/login/?returnTo=${encodeURIComponent(url.pathname + url.search + url.hash)}`;
}
function saveIdentity(kind: 'launch' | 'request', id: string) {
  if (imported && kind === 'request') storeConfiguration(id, imported);
  const url = imported ? new URL('/run/', location.origin) : repoRunUrl(launch?.options ?? options(), location.origin);
  url.hash = `${kind}=${id}`;
  history.replaceState(null, '', url);
  identity = { kind, id };
  updateSignIn();
}
async function request<T>(path: string, method = 'GET', body?: unknown, key?: string, timeoutMs = 65_000): Promise<T> {
  const response = await fetch(new URL(path, API_ORIGIN), { method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
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
  stopOutputStreams(); logCache.clear(); pendingPreviewId = undefined; previewExpiry = 0;
  progressPaused = false; progressCheckedAt = 0; previewError = false;
  element('run-source').textContent = ''; element('run-commit').textContent = '';
  element('run-phase').textContent = ''; logOutput.value = '';
  element('run-phase-detail').textContent = ''; element('run-activity').textContent = '';
  element<HTMLTextAreaElement>('run-help-text').value = '';
  element('run-progress').hidden = true;
  form.hidden = false; element('run-intro').hidden = !launchMode || Boolean(imported);
  element('run-preview-open').hidden = true;
  clearTimeout(timer);
  terminal?.dispose(); terminal = undefined; terminalHost.hidden = true;
  element('run-access').hidden = !launchMode;
  element('run-sign-in').hidden = false;
  element('run-plans').hidden = true;
  element('run-access-note').textContent = 'to run this repository in your account.';
  status.textContent = '';
  submit.disabled = false;
  submit.formNoValidate = true;
  updateSignIn();
}
async function copyConfiguration(button: HTMLButtonElement) {
  if (!launch && !validateRepo()) return;
  try {
    const value = launch ? { ...launch.options, ref: launch.repository.commit } : options();
    await navigator.clipboard.writeText(stringifyRepoRunConfig(value));
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 2000);
  } catch { error.textContent = 'Could not copy the configuration. Allow clipboard access and try again.'; error.hidden = false; }
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
  renderStatus();
  element<HTMLTextAreaElement>('run-help-text').value = repoSetupPrompt(launch.options, location.origin, launch, promptDiagnostics());
  element<HTMLButtonElement>('run-terminal-open').disabled = !active;
  element<HTMLButtonElement>('run-preview-create').disabled = !active;
  element('run-terminal-open').hidden = !launch.container || !launch.shellReadyAt && launch.phase !== 'failed' || launch.phase === 'stopped';
  if (launch.phase === 'stopped') { stopOutputStreams(); terminal?.dispose(); terminal = undefined; terminalHost.hidden = true; }
  else if (!terminalClosed && ['ready', 'failed'].includes(launch.phase)) openTerminal();
  element('run-preview').hidden = !launch.previewReadyAt || launch.phase === 'stopped';
}
async function logs() {
  if (!launch?.container || logsBusy || stopped || !active) return;
  const version = sessionVersion;
  const currentLaunch = launch;
  const container = currentLaunch.container;
  if (!container) return;
  const identityQuery = new URLSearchParams({ id: container.id, createdAt: container.createdAt });
  logsBusy = true;
  try {
    for (const [phase, id] of Object.entries(currentLaunch.executions)) {
      if (stopped || version !== sessionVersion) return;
      let cached = logCache.get(id);
      if (!cached?.finished) {
        try {
          const execution = await request<ExecutionDiagnostics>(`/containers/executions/${id}?${identityQuery}`, 'GET', undefined, undefined, 15_000);
          if (stopped || version !== sessionVersion) return;
          const latest = logCache.get(id);
          // A slow snapshot can arrive after the stream confirmed completion.
          // Terminal results are immutable; never regress them to running.
          if (latest?.finished && ['starting', 'running'].includes(execution.status)) cached = latest;
          else {
            const changed = !latest?.diagnostics || execution.stdout !== latest.diagnostics.stdout || execution.stderr !== latest.diagnostics.stderr;
            cached = { finished: !['starting', 'running'].includes(execution.status), diagnostics: execution, phase,
              checkedAt: Date.now(), changedAt: changed ? Date.now() : latest!.changedAt };
            logCache.set(id, cached);
          }
        } catch {
          if (stopped || version !== sessionVersion) return;
          cached = { ...cached, finished: false, phase, unavailable: true, checkedAt: cached?.checkedAt ?? 0, changedAt: cached?.changedAt ?? Date.now() };
          logCache.set(id, cached);
        }
      }
      if (!cached.unavailable) followExecution(id, identityQuery);
      renderLogs(); renderStatus();
    }
    if (!stopped && version === sessionVersion) {
      if (launch?.container) element<HTMLTextAreaElement>('run-help-text').value = repoSetupPrompt(launch.options, location.origin, launch, promptDiagnostics());
    }
  } finally { logsBusy = false; }
}
async function advance() {
  if (!launch || busy || stopped) return;
  const version = sessionVersion;
  busy = true;
  element('run-retry').hidden = true;
  progressPaused = false;
  error.hidden = true;
  try {
    const state = await request<RepositoryLaunch>(`/repo-launches/${launch.id}/advance`, 'POST');
    if (stopped || version !== sessionVersion) return;
    if (launch.phase !== state.phase) phaseObservedAt = Date.now();
    launch = state; progressCheckedAt = Date.now();
    render();
    if (launchedHere && launch.previewReadyAt && !previewAttempted) { previewAttempted = true; void createPreview(); }
    void logs();
    if (stopped || version !== sessionVersion || !launch) return;
    if (!['ready', 'failed', 'stopped'].includes(launch.phase)) timer = setTimeout(advance, 2000);
  } catch (cause) {
    if (stopped || version !== sessionVersion) return;
    showError(cause);
    progressPaused = true;
    renderStatus();
    element('run-retry').hidden = false;
  } finally { busy = false; }
}
async function run() {
  if (identity?.kind === 'request' && !validRepo(options().repo)) {
    error.textContent = 'This pending configuration is unavailable in this tab. Return to the original tab to resume this launch.';
    error.hidden = false; return;
  }
  if (!userId) {
    updateSignIn();
    location.href = element<HTMLAnchorElement>('run-sign-in').href;
    return;
  }
  if (busy || !active || stopped) return;
  const version = sessionVersion;
  const value = options();
  if (Boolean(value.startCommand) !== (value.port !== undefined)) {
    error.textContent = 'Supply both a start command and preview port. Ask your AI for a corrected configuration.';
    error.hidden = false; return;
  }
  if (!form.reportValidity()) return;
  if (!identity || identity.kind !== 'request') {
    try { saveIdentity('request', crypto.randomUUID()); }
    catch (cause) { showError(cause); return; }
  }
  busy = true;
  launchedHere = true;
  submit.disabled = true; fields.disabled = true;
  error.hidden = true;
  status.textContent = 'Validating repository…';
  try {
    const state = await request<RepositoryLaunch>('/repo-launches', 'POST', value, identity!.id);
    if (stopped || version !== sessionVersion) return;
    launch = state; phaseObservedAt = Date.now(); progressCheckedAt = Date.now();
    saveIdentity('launch', launch.id);
    render();
  } catch (cause) {
    if (!stopped && version === sessionVersion) {
      status.textContent = ''; showError(cause); submit.textContent = 'Resume launch';
      if ([400, 402, 413, 429].includes((cause as { status?: number }).status ?? 0)) {
        identity = null; history.replaceState(null, '', configurationUrl());
        updateSignIn();
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
  previewError = false;
  const button = element<HTMLButtonElement>('run-preview-create');
  const note = element('run-preview-status');
  const link = element<HTMLAnchorElement>('run-preview-open');
  button.disabled = true; link.hidden = true;
  note.textContent = 'Creating preview link…';
  renderStatus();
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
    previewError = true;
    note.textContent = cause instanceof Error && cause.message === 'container_not_running'
      ? 'Container stopped. Start a new run.' : 'Could not issue the link. Retry to reconcile existing grants and create a new link.';
  } finally { previewBusy = false; button.disabled = !active; if (!stopped && version === sessionVersion) renderStatus(); }
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
    element('run-access').hidden = !launchMode || active;
    element('run-sign-in').hidden = true;
    element('run-plans').hidden = active;
    element('run-plans').textContent = 'Add prepaid balance';
    element('run-access-note').textContent = 'to fund this repository run.';
    status.textContent = '';
    if (data.active) element('run-allowance').textContent = `${Math.max(0, data.limits.maxStartsPerMonth - data.usage.starts)} starts remaining this month. Each run uses your prepaid balance and monthly spending cap.`;
    if (identity?.kind === 'launch') {
      const state = await request<RepositoryLaunch>(`/repo-launches/${identity.id}`);
      if (stopped || version !== sessionVersion) return;
      launch = state; phaseObservedAt = Date.now(); progressCheckedAt = Date.now();
      launchedHere = !['ready', 'failed', 'stopped'].includes(launch.phase);
      render();
      if (active) void advance();
    }
  } catch (cause) { if (stopped || version !== sessionVersion) return; showError(cause); status.textContent = ''; element('run-retry').hidden = false; element('run-progress').hidden = false; }
}
form.addEventListener('submit', event => { event.preventDefault(); if (launchMode) void run(); else { preparePrompt(); void copyPrompt(); } });
form.addEventListener('input', event => {
  if (event.target === configInput) { importConfiguration(); return; }
  repo.setCustomValidity(''); element('run-prompt-status').textContent = '';
  if (launchMode) updateSignIn();
  else preparePrompt();
});
repo.addEventListener('change', () => { preparePrompt(); });
element('run-help-copy').onclick = () => { void copyPrompt(true); };
element<HTMLTextAreaElement>('run-prompt-text').addEventListener('copy', () => {
  const text = element<HTMLTextAreaElement>('run-prompt-text');
  if (validRepo(repo.value) && text.value && text.selectionStart === 0 && text.selectionEnd === text.value.length) {
    promptCopied = true;
    element('run-import-step').hidden = false;
    element('run-prompt-preview').hidden = true;
  }
});
element<HTMLButtonElement>('run-active-share').onclick = event => { void copyConfiguration(event.currentTarget as HTMLButtonElement); };
element('run-retry').onclick = () => { if (launch) void advance(); else void init(); };
element('run-terminal-open').onclick = openTerminal;
element('run-preview-create').onclick = () => { void createPreview(); };
followOutput.addEventListener('change', () => { if (followOutput.checked) logOutput.scrollTop = logOutput.scrollHeight; });
const expiryTimer = setInterval(() => {
  if (previewExpiry && previewExpiry <= Date.now()) { element('run-preview-open').hidden = true; element('run-preview-status').textContent = 'Preview link expired. Renew it to open the app again.'; previewExpiry = 0; }
  if (!stopped) renderStatus();
}, 1000);
const outputTimer = setInterval(() => { void logs(); }, 2000);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); clearInterval(expiryTimer); clearInterval(outputTimer); stopOutputStreams(); terminal?.dispose(); });
window.addEventListener('auth-change', () => { if (!launchMode) return; stopped = true; signIn(); element('run-progress').hidden = true; });
window.addEventListener('cookie-consent-change', event => {
  if (!launchMode) return;
  if ((event as CustomEvent).detail?.choice === 'accepted') { stopped = false; void init(); }
  else { stopped = true; signIn(); element('run-progress').hidden = true; }
});
updatePrompt();
preparePrompt();
if (configId && !imported) {
  element('run-import-status').textContent = 'This configuration is unavailable in this tab. Paste the AI response again.';
  element('run-import-status').className = 'dashboard-error';
}
if (launchMode) void init();
