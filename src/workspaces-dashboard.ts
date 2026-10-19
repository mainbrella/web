import type { ClientOptions, Container, ContainerIdentity, PersistenceCapabilities, RestoreLaunch } from './container-types.ts';
import { API_ORIGIN } from './platform.ts';
import { createWorkspaceJournal, type WorkspaceJournal, type WorkspaceOperation } from './workspace-operations.ts';

interface Workspace {
  id: string; name: string; expiresAt: number; status: string; archived: boolean; size: string;
  bytes?: number | null; reservedBytes?: number; launch?: RestoreLaunch; stopRequested?: boolean; stopCompleted?: boolean;
}
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function workspaceMetadata(input: unknown): Workspace {
  const value = input as Workspace | null;
  if (!value || !uuid(value.id) || typeof value.name !== 'string' || !Number.isSafeInteger(value.expiresAt)
    || !['saving', 'ready', 'failed', 'expired'].includes(value.status) || typeof value.archived !== 'boolean'
    || !['lite', 'small', 'medium', 'large', 'xl'].includes(value.size)) throw new Error('invalid_response');
  return { id: value.id, name: value.name, expiresAt: value.expiresAt, status: value.status, archived: value.archived, size: value.size,
    bytes: value.bytes, reservedBytes: value.reservedBytes, launch: value.launch, stopRequested: value.stopRequested, stopCompleted: value.stopCompleted };
}
export class WorkspaceRequestError extends Error {
  constructor(message: string, public status: number, public data: unknown) { super(message); }
}
export function createWorkspaceClient({ fetcher = fetch, onUnauthenticated, signal }: ClientOptions = {}) {
  return async (path: string, method = 'GET', body?: unknown, key?: string, exactBody?: string) => {
    const response = await fetcher(`${API_ORIGIN}${path}`, { method, credentials: 'include', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      headers: { accept: 'application/json', ...(body !== undefined || exactBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(exactBody !== undefined ? { body: exactBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) onUnauthenticated?.();
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new WorkspaceRequestError(typeof value?.error === 'string' ? value.error : 'workspaces_unavailable', response.status, value);
    return value;
  };
}
const bytes = (value: number) => value >= 1_000_000_000 ? `${Number((value / 1_000_000_000).toFixed(2))} GB`
  : value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(2))} MB` : `${value.toLocaleString()} bytes`;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
export function workspaceUsageRows(input: unknown): [string, string][] {
  const data = record(input), usage = record(data.usage), limits = record(data.limits);
  const fields = [
    ['Saved workspaces', 'saved', 'maxSaved', false],
    ['Saved disk reservation', 'reservedBytes', 'maxReservedBytes', true],
    ['Saves this month', 'savesThisMonth', 'maxSavesPerMonth', false],
    ['Capture reservation this month', 'captureBytesThisMonth', 'maxCaptureBytesPerMonth', true],
    ['Retained capture reservation', 'retainedCaptureBytes', 'maxRetainedCaptureBytes', true],
  ] as const;
  return fields.map(([label, field, limit, isBytes]) => {
    const used = usage[field], maximum = limits[limit];
    const format = (value: number) => isBytes ? bytes(value) : value.toLocaleString();
    return [label, nonnegative(used) ? `${format(used)}${nonnegative(maximum) ? ` / ${format(maximum)}` : ''}` : 'Unavailable'];
  });
}
export function workspaceUsageNote(input: unknown) {
  const date = (value: number) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const usage = record(record(input).usage);
  const monthly = nonnegative(usage?.captureBudgetResetsAt) ? `Monthly budgets reset ${date(usage.captureBudgetResetsAt)}.` : 'Monthly reset time is unavailable.';
  const retained = nonnegative(usage?.nextRetainedCaptureReleaseAt) && nonnegative(usage?.nextRetainedCaptureReleaseBytes)
    ? `${bytes(usage.nextRetainedCaptureReleaseBytes)} of retained reservation releases ${date(usage.nextRetainedCaptureReleaseAt)}.`
    : usage?.retainedCaptureBytes === 0 ? 'No retained capture reservation.' : 'Retained reservation release time is unavailable.';
  return `Capture budgets reserve the source machine’s disk capacity. Deleting releases saved capacity but does not reset capture budgets. ${monthly} ${retained}`;
}

const messages: Record<string, string> = {
  workspace_expired: 'This workspace has expired.', workspace_image_incompatible: 'This workspace needs an image version that is no longer deployed.',
  workspace_quota_exceeded: 'This save exceeds your saved-workspace count or disk reservation limit. Remove a saved workspace or use a smaller machine.',
  workspace_save_limit: 'You have reached your monthly workspace save limit.',
  workspace_capture_budget_exceeded: 'You have reached your monthly capture budget. Deleting workspaces does not reset it.',
  workspace_retained_budget_exceeded: 'Earlier capture reservations still use the retained budget. Check the release time above; deleting workspaces does not reset it.',
  workspace_not_ready: 'This workspace is unavailable for restore.', workspace_not_found: 'This workspace no longer exists.',
  subscription_required: 'Add prepaid balance to save or restore workspaces.', container_not_running: 'This container has stopped or been replaced.',
  workspace_storage_unavailable: 'Browser storage is unavailable. Enable local storage before saving or restoring so a lost response can be recovered safely.',
  workspace_journal_invalid: 'The saved request could not be read. Check your containers and workspaces before clearing this site’s stored request data.',
  workspace_request_pending: 'Resolve the pending save or restore before starting another.',
  workspace_request_changed: 'Another tab changed the saved request. Refresh to see its current state.',
  workspace_lock_unavailable: 'This browser cannot safely coordinate saved requests across tabs. Use a browser with Web Locks support to save or restore.',
  workspace_account_changed: 'The signed-in account changed. Reload before continuing.',
  workspace_recovery_expired: 'The safe retry window has expired. Check your containers and saved workspaces before discarding this request. It will not be sent again.',
  invalid_launch_recipe: 'Check the startup command, working directory, HTTP port, path, and readiness timeout.',
  workspace_launch_unavailable: 'Application startup on restore is unavailable in this environment.',
};

export function createWorkspacesDashboard({ getAccountId, onUnauthenticated, onChanged }: {
  getAccountId: () => string | null; onUnauthenticated: () => void; onChanged: () => Promise<void>;
}) {
  const host = document.querySelector<HTMLElement>('#saved-workspaces')!;
  if (!host) return { configure(_value: PersistenceCapabilities) {}, attach(_actions: HTMLElement, _container: Container) {}, setBusy(_value: boolean) {}, setVisible(_value: boolean) {}, updateContainers(_value: Container[]) {}, dispose() {} };
  const rows = host.querySelector<HTMLElement>('ul')!, status = host.querySelector<HTMLElement>('[role="status"]')!, error = host.querySelector<HTMLElement>('[role="alert"]')!;
  const refresh = host.querySelector<HTMLButtonElement>('[data-workspaces-refresh]')!, retry = host.querySelector<HTMLButtonElement>('[data-workspaces-retry]')!;
  const forget = host.querySelector<HTMLButtonElement>('[data-workspaces-forget]')!, pendingPanel = host.querySelector<HTMLElement>('[data-workspace-pending]')!;
  const pendingMessage = host.querySelector<HTMLElement>('[data-workspace-pending-message]')!;
  const usage = host.querySelector<HTMLElement>('[data-workspace-usage]')!, usageNote = host.querySelector<HTMLElement>('[data-workspace-usage-note]')!;
  const dialog = document.querySelector<HTMLDialogElement>('#workspace-save-dialog')!, form = dialog.querySelector<HTMLFormElement>('form')!;
  const name = form.querySelector<HTMLInputElement>('#workspace-name')!, stop = form.querySelector<HTMLInputElement>('.workspace-stop-choice input')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!, search = host.querySelector<HTMLInputElement>('#workspace-search')!;
  const dialogError = form.querySelector<HTMLElement>('[role="alert"]')!, dialogStatus = form.querySelector<HTMLElement>('[role="status"]')!;
  const launchSettings = form.querySelector<HTMLFieldSetElement>('[data-workspace-launch]')!, launchEnabled = form.querySelector<HTMLInputElement>('[data-workspace-launch-enabled]')!;
  const launchFields = form.querySelector<HTMLElement>('[data-workspace-launch-fields]')!;
  const command = form.querySelector<HTMLTextAreaElement>('#workspace-launch-command')!, cwd = form.querySelector<HTMLInputElement>('#workspace-launch-cwd')!;
  const port = form.querySelector<HTMLInputElement>('#workspace-launch-port')!, path = form.querySelector<HTMLInputElement>('#workspace-launch-path')!, timeout = form.querySelector<HTMLInputElement>('#workspace-launch-timeout')!;
  const abort = new AbortController(), request = createWorkspaceClient({ onUnauthenticated, signal: abort.signal });
  let active = false, supported = false, canSave = false, restoreLaunch = false, externalBusy = false, busy = false, disposed = false, version = 0;
  let selected: ContainerIdentity | null = null, returnFocus: HTMLElement | null = null;
  let journal: WorkspaceJournal | null = null, journalOwner: string | null = null, journalError = '';
  let pending: WorkspaceOperation | null = null;
  let notice = '';
  let containers: Container[] = [];
  const showError = (caught: unknown, target = error) => {
    const code = caught instanceof Error ? caught.message : '';
    target.textContent = messages[code] ?? 'The result could not be confirmed. Check the saved request before trying again.'; target.hidden = false;
  };
  function readPending() {
    const accountId = getAccountId();
    if (!accountId || disposed) { pending = null; return; }
    try {
      if (journalOwner !== accountId) { journalOwner = accountId; journal = createWorkspaceJournal({ accountId, apiOrigin: API_ORIGIN }); }
      pending = journal!.read(); journalError = '';
    } catch (caught) { journalError = caught instanceof Error ? caught.message : 'workspace_storage_unavailable'; pending = null; }
  }
  function controls() {
    readPending();
    const disabled = busy || externalBusy || disposed;
    refresh.disabled = disabled;
    pendingPanel.hidden = !pending && !journalError;
    if (journalError) pendingMessage.textContent = messages[journalError] ?? messages.workspace_journal_invalid;
    else if (pending) pendingMessage.textContent = !journal!.retryable(pending) ? messages.workspace_recovery_expired
      : pending.resource ? `${pending.kind === 'save' ? 'Save' : 'Restore'} accepted. Checking its recorded result; a retry uses the same original request.`
      : `${pending.kind === 'save' ? 'Save' : 'Restore'} response unconfirmed. Retry the original request to recover its result without creating another.`;
    retry.hidden = !pending; retry.disabled = disabled || !pending || !journal?.retryable(pending);
    forget.hidden = !pending; forget.disabled = disabled;
    submit.disabled = disabled || Boolean(journalError) || pending?.kind === 'restore' || Boolean(pending && !journal?.retryable(pending));
    submit.textContent = pending?.kind === 'save' ? 'Retry original save' : 'Save workspace';
    name.disabled = disabled || Boolean(pending); stop.disabled = disabled || Boolean(pending);
    launchSettings.hidden = !restoreLaunch;
    launchEnabled.disabled = disabled || Boolean(pending);
    launchFields.hidden = !launchEnabled.checked;
    for (const input of [command, cwd, port, path, timeout]) { input.disabled = disabled || Boolean(pending) || !launchEnabled.checked; input.required = launchEnabled.checked; }
    host.querySelectorAll<HTMLButtonElement>('button[data-workspace-action]').forEach(button => {
      button.disabled = disabled || button.dataset.unavailable === 'true' || button.dataset.workspaceAction === 'restore' && Boolean(pending || journalError);
    });
  }
  function filter() {
    let matches = 0;
    for (const row of rows.children) { const item = row as HTMLElement; item.hidden = !item.dataset.name!.includes(search.value.trim().toLowerCase()); if (!item.hidden) matches++; }
    status.textContent = notice || (rows.children.length ? (matches ? '' : 'No saved workspaces match your search.') : "You haven't saved any workspaces.");
  }
  function finish(operation: WorkspaceOperation, message: string) {
    journal!.finish(operation); pending = null; notice = message; status.textContent = message;
  }
  function resolveRestore(operation: WorkspaceOperation, container: Container) {
    if (container.status !== 'running') return;
    if (container.readiness?.status === 'starting') return;
    finish(operation, container.readiness?.status === 'failed' ? 'Filesystem restored. The application did not become ready; inspect its startup log in Containers.'
      : container.readiness?.status === 'ready' ? 'Workspace restored. Application ready.' : 'Filesystem restored. Start your application from the terminal.');
  }
  async function reconcile(action: (operation: WorkspaceOperation) => void) {
    readPending();
    const currentJournal = journal;
    if (!currentJournal || !pending?.resource || disposed) return;
    try {
      await currentJournal.exclusive(async () => {
        if (disposed || currentJournal !== journal) return;
        const operation = currentJournal.read();
        if (operation?.resource) action(operation);
      });
    } catch (caught) { if (!disposed) showError(caught); }
    if (!disposed) controls();
  }
  function updateContainers(value: Container[]) {
    containers = value;
    void reconcile(operation => {
      if (operation.kind !== 'restore') return;
      const container = containers.find(item => item.id === operation.resource!.id && item.createdAt === operation.resource!.createdAt);
      if (container) resolveRestore(operation, container);
    });
  }
  async function load() {
    if (!supported || busy || disposed) return;
    const current = ++version;
    status.textContent = 'Loading saved workspaces…';
    try {
      const result = await request('/workspaces');
      if (disposed || current !== version) return;
      if (!Array.isArray(result?.workspaces)) throw new Error('invalid_response');
      const workspaces = (result.workspaces as unknown[]).map(workspaceMetadata);
      usage.replaceChildren();
      for (const [label, value] of workspaceUsageRows(result)) {
        const term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = label; description.textContent = value; usage.append(term, description);
      }
      usageNote.textContent = workspaceUsageNote(result);
      rows.replaceChildren();
      for (const workspace of workspaces) {
        const row = document.createElement('li'); row.className = 'container-row'; row.dataset.name = workspace.name.toLowerCase();
        const details = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('p');
        title.textContent = workspace.name; meta.className = 'dashboard-status';
        meta.textContent = `${workspace.archived ? 'Archived' : workspace.status === 'ready' ? 'Saved' : workspace.status === 'saving' ? 'Saving…' : workspace.status === 'failed' ? 'Failed' : 'Expired'} · ${workspace.size.toUpperCase()} · Expires ${new Date(workspace.expiresAt).toLocaleDateString()}${nonnegative(workspace.bytes) ? ` · ${bytes(workspace.bytes)} snapshot` : ''}${nonnegative(workspace.reservedBytes) ? ` · ${bytes(workspace.reservedBytes)} reserved` : ''}`;
        details.append(title, meta);
        if (workspace.launch) {
          const launch = document.createElement('p'); launch.className = 'dashboard-status';
          launch.textContent = `On restore: ${workspace.launch.command} · HTTP ${workspace.launch.readiness.port}${workspace.launch.readiness.path || '/'}`;
          details.append(launch);
        }
        const actions = document.createElement('div'); actions.className = 'container-actions';
        for (const [label, action] of [['Restore', 'restore'], [workspace.archived ? 'Unarchive' : 'Archive', 'archive'], ['Delete', 'delete']]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = label; button.dataset.workspaceAction = action;
          button.setAttribute('aria-label', `${label} ${workspace.name}`);
          button.dataset.unavailable = String(action === 'restore' && (!canSave || workspace.archived || workspace.status !== 'ready' || workspace.expiresAt <= Date.now()));
          button.onclick = () => operate(workspace, action); actions.append(button);
        }
        row.append(details, actions); rows.append(row);
      }
      filter(); readPending();
      await reconcile(operation => {
        if (operation.kind !== 'save') return;
        const workspace = workspaces.find(item => item.id === operation.resource!.id);
        if (workspace?.status === 'ready' && (!workspace.stopRequested || workspace.stopCompleted)) finish(operation, 'Workspace saved.');
      });
      controls();
    } catch (caught) {
      if (!disposed && current === version) { status.textContent = ''; error.textContent = 'Could not load saved workspaces. Refresh to try again.'; error.hidden = false; }
    }
  }
  async function verifyAccount() {
    const expected = journalOwner;
    const session = await request('/auth/me');
    if (disposed || !expected || session?.user?.id !== expected || getAccountId() !== expected) throw new Error('workspace_account_changed');
  }
  async function sendPending(operation: WorkspaceOperation) {
    if (!journal!.retryable(operation)) throw new Error('workspace_recovery_expired');
    await verifyAccount();
    if (disposed || journal!.read()?.key !== operation.key) throw new Error('workspace_request_changed');
    const result = await request(operation.kind === 'save' ? '/workspaces' : '/containers', 'POST', undefined, operation.key, operation.bodyText);
    if (disposed) return;
    if (operation.kind === 'save') {
      const workspace = workspaceMetadata(result);
      journal!.rememberResource(operation, { id: workspace.id });
      if (workspace.status === 'ready' && (!workspace.stopRequested || workspace.stopCompleted)) { finish(operation, 'Workspace saved.'); dialog.close(); }
    } else {
      const creation = result?.creation;
      if (!creation || typeof creation.containerId !== 'string' || typeof creation.createdAt !== 'string') throw new Error('invalid_response');
      journal!.rememberResource(operation, { id: creation.containerId, createdAt: creation.createdAt });
      const container = result.containers?.find((item: Container) => item.id === creation.containerId && item.createdAt === creation.createdAt);
      resolveRestore(operation, container ?? { id: creation.containerId, createdAt: creation.createdAt, status: creation.status, expiresAt: 0, readiness: creation.readiness });
    }
  }
  async function mutation(action: () => Promise<void>, inDialog = false, durable = true) {
    if (busy || externalBusy || disposed) return;
    busy = true; version++; notice = ''; error.hidden = true; dialogError.hidden = true; controls();
    try {
      if (durable) {
        if (!journal) throw new Error('workspace_storage_unavailable');
        await journal.exclusive(action);
      } else await action();
    } catch (caught) { if (!disposed) showError(caught, inDialog && dialog.open ? dialogError : error); }
    finally {
      busy = false; dialogStatus.textContent = '';
      if (!disposed) { controls(); await onChanged(); await load(); }
    }
  }
  async function operate(workspace: Workspace, action: string) {
    if (busy || externalBusy || disposed) return;
    if (action === 'delete' && !window.confirm(`Delete “${workspace.name}”? This revokes future restores and releases its saved-workspace reservation. Running restores continue. Capture budgets remain used until they expire; provider snapshot data is not immediately erased.`)) return;
    await mutation(async () => {
      await verifyAccount();
      if (action === 'restore') {
        const operation = journal!.begin('restore', { workspaceId: workspace.id });
        await sendPending(operation);
      } else {
        await request(`/workspaces/${workspace.id}`, action === 'delete' ? 'DELETE' : 'PATCH', action === 'archive' ? { archived: !workspace.archived } : undefined);
        if (!disposed) { notice = action === 'delete' ? 'Future restores revoked. Saved-workspace reservation released.' : 'Workspace updated.'; status.textContent = notice; }
      }
    }, false, action === 'restore');
  }
  function open(container: Container, trigger: HTMLElement) {
    controls();
    if (pending || journalError) { error.textContent = pending ? messages.workspace_request_pending : messages[journalError]; error.hidden = false; return; }
    selected = { id: container.id, createdAt: container.createdAt }; returnFocus = trigger;
    name.value = container.name || container.imageName || 'My workspace'; stop.checked = false;
    const launch = container.launch;
    launchEnabled.checked = Boolean(launch); command.value = launch?.command ?? ''; cwd.value = launch?.cwd ?? '/workspace';
    port.value = launch ? String(launch.readiness.port) : ''; path.value = launch?.readiness.path ?? '/'; timeout.value = String((launch?.readiness.timeoutMs ?? 30_000) / 1000);
    dialogError.hidden = true; dialogStatus.textContent = ''; controls(); dialog.showModal(); name.focus();
  }
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || externalBusy || disposed || !selected || !form.reportValidity()) return;
    if (!name.value.trim()) { dialogError.textContent = 'Enter a workspace name.'; dialogError.hidden = false; name.focus(); return; }
    const body = { ...selected, name: name.value.trim(), stop: stop.checked,
      ...(restoreLaunch && launchEnabled.checked ? { launch: { command: command.value.trim(), cwd: cwd.value.trim(),
        readiness: { port: Number(port.value), path: path.value, timeoutMs: Number(timeout.value) * 1000 } } } : {}) };
    dialogStatus.textContent = 'Saving filesystem…';
    await mutation(async () => {
      readPending();
      const operation = pending ?? journal!.begin('save', body);
      if (operation.kind !== 'save') throw new Error('workspace_request_pending');
      await sendPending(operation);
    }, true);
  };
  form.querySelector<HTMLButtonElement>('[data-workspace-cancel]')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => returnFocus?.focus({ preventScroll: true }));
  launchEnabled.addEventListener('change', controls);
  retry.onclick = () => mutation(async () => { readPending(); if (pending) await sendPending(pending); });
  forget.onclick = () => {
    if (!pending || busy || externalBusy) return;
    const operation = pending;
    if (!window.confirm('Discard this browser’s saved request only after checking the containers and saved workspaces. This does not cancel server work. Starting another operation may create another resource.')) return;
    void mutation(async () => { journal!.finish(operation); });
  };
  refresh.onclick = () => { error.hidden = true; void onChanged(); void load(); };
  search.addEventListener('input', () => { notice = ''; filter(); });
  const storageChanged = (event: StorageEvent) => { if (!disposed && event.key === journal?.storageKey) controls(); };
  window.addEventListener('storage', storageChanged);
  return {
    configure(value: PersistenceCapabilities = {}) {
      const next = value.workspaces === true || value.snapshots === true;
      canSave = value.snapshots === true; restoreLaunch = value.restoreLaunch === true; search.disabled = !next; host.hidden = !active;
      if (!next) status.textContent = 'Saved workspaces are unavailable in this environment.';
      if (next && !supported) { supported = true; void load(); } else supported = next;
      controls();
    },
    attach(actions: HTMLElement, container: Container) {
      if (!canSave) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = 'Save workspace';
      button.dataset.action = 'save-workspace'; button.dataset.requiresRunning = 'true'; button.dataset.running = String(container.status === 'running');
      button.onclick = () => { if (!busy && !externalBusy) open(container, button); }; actions.append(button);
    },
    updateContainers,
    setVisible(value: boolean) { active = value; host.hidden = !active; if (!supported) status.textContent = 'Saved workspaces are unavailable in this environment.'; },
    setBusy(value: boolean) { externalBusy = value; controls(); },
    dispose() {
      disposed = true; version++; abort.abort(); pending = null; journal = null; dialog.close(); rows.replaceChildren(); usage.replaceChildren(); host.hidden = true;
      window.removeEventListener('storage', storageChanged);
    },
  };
}
