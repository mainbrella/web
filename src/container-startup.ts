import { API_ORIGIN } from './platform.ts';
import type { ClientOptions, Container, ContainerIdentity, RestoreLaunch } from './container-types.ts';

export function startupRecipe(value: unknown): RestoreLaunch {
  const launch = value as RestoreLaunch | null;
  const cwd = launch?.cwd ?? '/workspace', path = launch?.readiness?.path ?? '/', timeoutMs = launch?.readiness?.timeoutMs ?? 30_000;
  if (!launch || typeof launch.command !== 'string' || !launch.command.trim() || launch.command.length > 4096 || launch.command.includes('\0')
    || typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.length > 1024 || /[\0\r\n]/.test(cwd)
    || !Number.isInteger(launch.readiness?.port) || launch.readiness.port < 1024 || launch.readiness.port > 65535
    || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 1024 || /[\s\\#\x00-\x1f\x7f]/.test(path)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error('invalid_launch_recipe');
  return { command: launch.command, cwd, readiness: { port: launch.readiness.port, path, timeoutMs } };
}

export function createStartupClient({ fetcher = fetch, onUnauthenticated, signal }: ClientOptions = {}) {
  return async (container: ContainerIdentity, input: RestoreLaunch | null) => {
    const launch = input === null ? null : startupRecipe(input);
    const response = await fetcher(`${API_ORIGIN}/containers/startup`, { method: 'PATCH', credentials: 'include', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ id: container.id, createdAt: container.createdAt, launch }) });
    if (response.status === 401) onUnauthenticated?.();
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'startup_unavailable');
    if (result?.id !== container.id || result?.createdAt !== container.createdAt || result.launch === undefined) throw new Error('invalid_response');
    const saved = result.launch === null ? null : startupRecipe(result.launch);
    if (JSON.stringify(saved) !== JSON.stringify(launch)) throw new Error('invalid_response');
    return saved;
  };
}

export function startupError(code: string) {
  const messages: Record<string, string> = {
    invalid_launch_recipe: 'Check the startup command, absolute working directory, HTTP port, path, and readiness timeout.',
    container_not_running: 'This container has stopped or been replaced. Close settings and refresh containers.',
    workspace_launch_unavailable: 'Application startup settings are unavailable in this environment.',
    startup_unavailable: 'Could not save startup settings. Refresh containers to check the saved command, then try again.',
    production_startup_managed: 'Production containers use their production startup command.',
    subscription_required: 'Add prepaid balance to update startup settings.',
  };
  return messages[code] ?? messages.startup_unavailable;
}

export function createContainerStartup({ onUnauthenticated, onChanged }: { onUnauthenticated: () => void; onChanged: () => Promise<void> }) {
  const dialog = document.querySelector<HTMLDialogElement>('#container-startup-dialog')!;
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const enabled = form.querySelector<HTMLInputElement>('[data-startup-enabled]')!;
  const fields = form.querySelector<HTMLFieldSetElement>('[data-startup-fields]')!;
  const command = form.querySelector<HTMLTextAreaElement>('#startup-command')!, cwd = form.querySelector<HTMLInputElement>('#startup-cwd')!;
  const port = form.querySelector<HTMLInputElement>('#startup-port')!, path = form.querySelector<HTMLInputElement>('#startup-path')!, timeout = form.querySelector<HTMLInputElement>('#startup-timeout')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const status = form.querySelector<HTMLElement>('[role="status"]')!, error = form.querySelector<HTMLElement>('[role="alert"]')!;
  const abort = new AbortController(), request = createStartupClient({ onUnauthenticated, signal: abort.signal });
  let supported = false, busy = false, externalBusy = false, disposed = false;
  let containers: Container[] = [], selected: ContainerIdentity | null = null, trigger: HTMLElement | null = null;
  const current = () => containers.find(item => item.id === selected?.id && item.createdAt === selected?.createdAt && item.status === 'running' && item.lifecycle !== 'production');
  function controls() {
    const disabled = busy || externalBusy || disposed || !supported || !current();
    enabled.disabled = disabled; fields.disabled = disabled || !enabled.checked; fields.hidden = !enabled.checked;
    for (const input of [command, cwd, port, path, timeout]) input.required = enabled.checked;
    submit.disabled = disabled;
  }
  function open(container: Container, button: HTMLElement) {
    if (busy || externalBusy || disposed || !supported) return;
    selected = { id: container.id, createdAt: container.createdAt }; trigger = button;
    const launch = container.launch;
    enabled.checked = Boolean(launch); command.value = launch?.command ?? ''; cwd.value = launch?.cwd ?? '/workspace';
    port.value = launch ? String(launch.readiness.port) : ''; path.value = launch?.readiness.path ?? '/';
    timeout.value = String((launch?.readiness.timeoutMs ?? 30_000) / 1000);
    form.querySelector<HTMLElement>('[data-startup-container]')!.textContent = container.name || container.id;
    status.textContent = ''; error.hidden = true; controls(); dialog.showModal(); enabled.focus();
  }
  enabled.addEventListener('change', controls);
  form.addEventListener('input', () => { status.textContent = ''; });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || externalBusy || disposed || !supported || !current() || !selected || !form.reportValidity()) return;
    busy = true; error.hidden = true; status.textContent = 'Saving startup settings…'; controls();
    try {
      const launch = enabled.checked ? startupRecipe({ command: command.value.trim(), cwd: cwd.value.trim(),
        readiness: { port: Number(port.value), path: path.value, timeoutMs: Number(timeout.value) * 1000 } }) : null;
      await request(selected, launch);
      if (disposed) return;
      await onChanged();
      if (!disposed && current()) status.textContent = launch ? 'Saved. Future resumes and forks will use this command.' : 'Saved. Future resumes and forks will restore files without starting an application.';
    } catch (caught) {
      if (!disposed) { status.textContent = ''; error.textContent = startupError(caught instanceof Error ? caught.message : ''); error.hidden = false; }
    } finally { busy = false; if (!disposed) controls(); }
  };
  form.querySelector<HTMLButtonElement>('[data-startup-close]')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (!disposed) (trigger?.isConnected ? trigger : document.querySelector<HTMLElement>('#containers-refresh'))?.focus({ preventScroll: true });
  });
  return {
    configure(value: boolean) { supported = value; controls(); },
    sync(value: Container[]) {
      containers = value;
      if (dialog.open && !current()) { status.textContent = ''; error.textContent = startupError('container_not_running'); error.hidden = false; }
      controls();
    },
    attach(actions: HTMLElement, container: Container) {
      if (!supported || container.status !== 'running' || container.lifecycle === 'production') return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dashboard-retry';
      button.textContent = 'Startup settings'; button.dataset.action = 'startup'; button.dataset.requiresRunning = 'true'; button.dataset.running = 'true';
      button.setAttribute('aria-label', `Startup settings for ${container.name || container.id}`);
      button.onclick = () => open(container, button); actions.append(button);
    },
    setBusy(value: boolean) { externalBusy = value; controls(); },
    dispose() { disposed = true; abort.abort(); dialog.close(); containers = []; selected = null; },
  };
}
