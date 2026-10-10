import { BuildAPIError, buildErrorMessage, createBuildClient, safeBuildPreviewURL, type BuildApp, type BuildConfig, type BuildSource } from './build-api.ts';
import { buildExamples, createBuildDraftStore } from './build-drafts.ts';

export function createBuildDashboard({ onUnauthenticated }: { onUnauthenticated: () => void }) {
  const host = document.querySelector<HTMLElement>('#dashboard-build')!;
  const node = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const home = node<HTMLElement>('#build-home');
  const workspace = node<HTMLElement>('#build-workspace');
  const prompt = node<HTMLTextAreaElement>('#build-prompt');
  const create = node<HTMLButtonElement>('#build-create');
  const update = node<HTMLTextAreaElement>('#build-update');
  const send = node<HTMLButtonElement>('#build-update-save');
  const name = node<HTMLInputElement>('#build-draft-name');
  const list = node<HTMLElement>('#build-draft-list');
  const messages = node<HTMLElement>('#build-messages');
  const progress = node<HTMLElement>('#build-progress');
  const error = node<HTMLElement>('#build-storage-error');
  const retry = node<HTMLButtonElement>('#build-retry');
  const status = node<HTMLElement>('#build-save-status');
  const previewStatus = node<HTMLElement>('#build-preview-status');
  const frame = node<HTMLIFrameElement>('#build-preview-frame');
  const openPreview = node<HTMLAnchorElement>('#build-open-preview');
  const file = node<HTMLSelectElement>('#build-file');
  const code = node<HTMLElement>('#build-code');
  const tabs = ['preview', 'code', 'logs'].map(id => node<HTMLButtonElement>(`#build-${id}-tab`));
  const controller = new AbortController();
  const client = createBuildClient(() => { dispose(); onUnauthenticated(); }, controller.signal);
  let config: BuildConfig | null = null;
  let apps: BuildApp[] = [];
  let selected: BuildApp | null = null;
  let source: BuildSource | null = null;
  let sourceVersion = 0;
  let userId: string | null = null;
  let disposed = false;
  let busy = false;
  let loaded = false;
  let refreshing = false;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAction: (() => unknown) | null = null;
  let conversationKey = '';
  let pendingSubmission: { signature: string; key: string } | null = null;
  let stopWatching: (() => void) | null = null;
  let watchedAppId: string | null = null;
  let optimistic: { text: string; newApp: boolean } | null = null;

  function controls() {
    const locked = busy || disposed;
    const active = apps.some(app => app.activeTurnId) || Boolean(selected?.activeTurnId);
    const available = config?.available && loaded && !active;
    create.disabled = locked || !available || !prompt.value.trim() || apps.length >= (config?.maxApps ?? 50);
    send.disabled = locked || !available || !selected || !update.value.trim();
    create.textContent = busy && !selected ? 'Starting…' : 'Build app ↑';
    send.textContent = busy ? 'Sending…' : 'Send ↑';
    for (const input of [prompt, update, name]) input.disabled = locked;
    for (const button of host.querySelectorAll<HTMLButtonElement>('.build-workspace-heading button, .build-draft-open, .build-draft-delete')) button.disabled = locked;
    node<HTMLButtonElement>('#build-stop').disabled = locked || Boolean(selected?.activeTurnId);
    node<HTMLButtonElement>('#build-start-preview').disabled = locked || !available;
    node<HTMLButtonElement>('#build-resume').disabled = locked || !config?.available;
    retry.disabled = locked;
    create.title = active ? 'A build is already running in your account.' : apps.length >= (config?.maxApps ?? 50) ? 'Delete an app to make room.' : '';
    send.title = active ? 'You can write your next change while Build works.' : '';
    node<HTMLElement>('.build-more').hidden = !selected;
  }

  function clearError() { error.hidden = true; retry.hidden = true; retryAction = null; }
  function reportError(cause: unknown, action: () => unknown) {
    if (disposed) return;
    error.textContent = cause instanceof Error ? cause.message : 'Could not reach Build. Please try again.';
    error.hidden = false;
    retryAction = action;
    retry.hidden = false;
  }
  function remember(app: BuildApp) {
    apps = [app, ...apps.filter(item => item.id !== app.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function setAppURL(id: string | null) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('app', id); else url.searchParams.delete('app');
    history.replaceState(null, '', url);
  }

  // Reuse a submission key after a lost response, including a reload in this tab.
  function submissionKey(signature: string) {
    const storageKey = `mainbrella-build-submission:v1:${userId}`;
    if (!pendingSubmission) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (typeof saved?.signature === 'string' && typeof saved?.key === 'string'
          && /^[a-f0-9-]{36}$/.test(saved.key)) pendingSubmission = saved;
      } catch { /* Requests also work when browser storage is unavailable. */ }
    }
    if (pendingSubmission?.signature !== signature) pendingSubmission = { signature, key: crypto.randomUUID() };
    try { sessionStorage.setItem(storageKey, JSON.stringify(pendingSubmission)); } catch { /* Keep the key in memory. */ }
    return pendingSubmission.key;
  }
  function clearSubmission(key: string) {
    if (pendingSubmission?.key !== key) return;
    pendingSubmission = null;
    try { sessionStorage.removeItem(`mainbrella-build-submission:v1:${userId}`); } catch { /* Optional storage. */ }
  }

  function renderList() {
    list.replaceChildren();
    const empty = node<HTMLElement>('#build-empty');
    empty.hidden = apps.length > 0;
    empty.textContent = loaded ? "You haven't built any apps yet." : 'Loading your apps…';
    for (const app of apps) {
      const row = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'build-draft-open';
      const title = document.createElement('strong'); title.textContent = app.name;
      const excerpt = document.createElement('span'); excerpt.textContent = app.prompt;
      const meta = document.createElement('span'); meta.className = 'build-draft-meta';
      meta.textContent = `${app.activeTurnId ? 'Building' : app.preview ? 'Preview ready' : app.revision ? `Revision ${app.revision}` : 'Needs attention'} · ${new Date(app.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      open.append(title, excerpt, meta);
      open.addEventListener('click', () => void openApp(app.id));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'build-draft-delete'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${app.name}`);
      remove.hidden = Boolean(app.activeTurnId);
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete “${app.name}”? Its source and conversation will be deleted and its sandbox stopped.`)) return;
        void mutate(() => client.remove(app.id), () => {
          apps = apps.filter(item => item.id !== app.id);
          renderList();
          (list.querySelector<HTMLButtonElement>('button') ?? prompt).focus();
        });
      });
      row.append(open, remove); list.append(row);
    }
    controls();
  }

  function renderConversation(app: BuildApp) {
    const key = JSON.stringify(app.turns);
    if (key === conversationKey) return;
    conversationKey = key;
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    const existing = new Map(Array.from(messages.children, child => [(child as HTMLElement).dataset.messageKey, child as HTMLElement]));
    const rows: HTMLElement[] = [];
    function message(key: string, label: string, text: string, className = '') {
      let row = existing.get(key);
      if (!row) {
        row = document.createElement('li'); row.dataset.messageKey = key;
        row.append(document.createElement('span'), document.createElement('p'));
      }
      row.className = className;
      if (row.children[0].textContent !== label) row.children[0].textContent = label;
      if (row.children[1].textContent !== text) row.children[1].textContent = text;
      rows.push(row);
    }
    for (const turn of app.turns ?? []) {
      message(`user-${turn.id}`, 'You', turn.mode === 'preview' ? 'Restart the preview from saved source.' : turn.prompt);
      for (const item of turn.activity ?? []) {
        if (item.type === 'tool') {
          const state = item.status === 'running' && turn.status === 'failed' ? 'failed' : item.status;
          message(`${turn.id}-${item.id}`, state === 'running' ? '…' : state === 'failed' ? '!' : '✓', item.text, `build-tool build-tool-${state}`);
          rows.at(-1)!.children[0].setAttribute('aria-label', state === 'running' ? 'In progress' : state === 'failed' ? 'Failed' : 'Completed');
        } else message(`${turn.id}-${item.id}`, 'Build', item.text, item.status === 'running' && app.activeTurnId === turn.id ? 'build-message-streaming' : '');
      }
      if (turn.status === 'failed') message(`result-${turn.id}`, 'Build', buildErrorMessage(turn.error || 'build_failed'), 'build-message-error');
      else if (turn.summary && !turn.activity?.some(item => item.type === 'message' && item.text === turn.summary)) message(`result-${turn.id}`, 'Build', turn.summary);
      else if (!turn.activity?.length && turn.status === 'succeeded') message(`result-${turn.id}`, 'Build', turn.stage);
    }
    for (const row of Array.from(messages.children)) if (!rows.includes(row as HTMLElement)) row.remove();
    rows.forEach((row, index) => { if (messages.children[index] !== row) messages.insertBefore(row, messages.children[index] ?? null); });
    if (nearBottom) messages.scrollTop = messages.scrollHeight;
    node<HTMLElement>('#build-logs').textContent = (app.turns ?? []).map(turn =>
      `${turn.mode === 'preview' ? 'Preview' : 'Build'} · ${turn.stage}${turn.activity?.length ? `\n${turn.activity.map(item => item.text).join('\n')}` : ''}${turn.error ? `\n${buildErrorMessage(turn.error)}` : ''}${turn.log ? `\n${turn.log}` : ''}`
    ).join('\n\n') || 'No build output yet.';
  }

  function renderPreview() {
    if (!selected) return;
    const preview = selected.preview;
    const url = preview && preview.expiresAt > Date.now() ? safeBuildPreviewURL(preview.url) : null;
    const empty = node<HTMLElement>('#build-preview-empty');
    const panel = node<HTMLElement>('#build-preview-panel');
    empty.hidden = Boolean(url); frame.hidden = !url;
    panel.classList.toggle('has-preview', Boolean(url));
    openPreview.hidden = !url;
    if (url) {
      openPreview.href = url;
      if (frame.getAttribute('src') !== url) frame.src = url;
      previewStatus.textContent = `Temporary preview · expires ${new Date(preview!.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    } else {
      frame.removeAttribute('src'); openPreview.removeAttribute('href');
      const turn = selected.turns?.at(-1);
      previewStatus.textContent = selected.activeTurnId ? 'Building…' : 'Preview stopped';
      node<HTMLElement>('#build-preview-description').textContent = selected.activeTurnId ? 'Follow the live progress in the conversation.'
        : turn?.status === 'failed' ? 'Check Logs, then ask Build to fix the app.'
          : selected.revision ? 'Your source is saved. Start a preview to run your app again.' : 'Describe a change to continue building your app.';
    }
    node<HTMLButtonElement>('#build-start-preview').hidden = Boolean(url || selected.activeTurnId || !selected.revision);
    node<HTMLButtonElement>('#build-stop').hidden = !selected.container;
    node<HTMLButtonElement>('#build-resume').hidden = !selected.activeTurnId || selected.turns?.at(-1)?.status !== 'queued'
      || Date.now() - Date.parse(selected.turns.at(-1)!.createdAt) < 15_000;
  }

  function renderApp(app: BuildApp) {
    selected = app; remember(app);
    home.hidden = true; workspace.hidden = false;
    if (document.activeElement !== name) name.value = app.name;
    node<HTMLElement>('#build-revision').textContent = app.revision ? `Revision ${app.revision}` : 'New app';
    const turn = app.turns?.at(-1);
    status.textContent = app.activeTurnId ? 'You can write your next change' : turn?.status === 'failed' ? 'Ask Build to try again' : 'Changes saved';
    const lastActivity = turn?.activity?.at(-1);
    progress.hidden = !app.activeTurnId || lastActivity?.type === 'tool' && lastActivity.status === 'running' && lastActivity.text === turn?.stage;
    progress.textContent = app.activeTurnId ? turn?.stage || 'Connecting to Build…' : '';
    messages.setAttribute('aria-busy', String(Boolean(app.activeTurnId)));
    workspace.classList.toggle('is-building', Boolean(app.activeTurnId));
    renderConversation(app); renderPreview(); controls();
    watchApp();
  }

  function disconnectStream() {
    stopWatching?.(); stopWatching = null; watchedAppId = null;
  }
  function watchApp() {
    if (disposed || document.hidden || !selected?.activeTurnId) { disconnectStream(); return; }
    if (watchedAppId === selected.id) return;
    disconnectStream(); clearTimeout(timer);
    const id = selected.id;
    watchedAppId = id;
    stopWatching = client.watch(id, app => {
      if (disposed || selected?.id !== id || busy) return;
      const changed = selected.revision !== app.revision;
      clearError(); renderApp(app);
      if (changed && tabs[1].getAttribute('aria-selected') === 'true') void loadSource();
      schedule();
    }, () => {
      if (disposed || selected?.id !== id) return;
      disconnectStream(); schedule();
    });
  }

  function renderPending(text: string) {
    optimistic = { text, newApp: !selected };
    disconnectStream();
    if (!selected) {
      home.hidden = true; workspace.hidden = false;
      name.value = text.split(/\r?\n/)[0].slice(0, 64);
      node<HTMLElement>('#build-revision').textContent = 'New app';
      messages.replaceChildren(); conversationKey = '';
      node<HTMLElement>('#build-logs').textContent = 'Sending your request…';
      frame.hidden = true; frame.removeAttribute('src'); openPreview.hidden = true;
      node<HTMLElement>('#build-preview-empty').hidden = false;
      node<HTMLElement>('#build-preview-panel').classList.remove('has-preview');
      node<HTMLElement>('#build-preview-description').textContent = 'Follow the live progress in the conversation.';
      previewStatus.textContent = 'Getting started…';
      for (const id of ['start-preview', 'stop', 'resume']) node<HTMLButtonElement>(`#build-${id}`).hidden = true;
    }
    const row = document.createElement('li'), label = document.createElement('span'), paragraph = document.createElement('p');
    label.textContent = 'You'; paragraph.textContent = text; row.append(label, paragraph); messages.append(row);
    messages.scrollTop = messages.scrollHeight;
    progress.hidden = false; progress.textContent = 'Sending your request…';
    status.textContent = '';
    messages.setAttribute('aria-busy', 'true'); workspace.classList.add('is-building');
    setTab(tabs[0]);
  }

  async function loadSource() {
    if (!selected || disposed) return;
    const id = selected.id, current = ++sourceVersion;
    node<HTMLElement>('#build-code-panel').setAttribute('aria-busy', 'true');
    try {
      const next = await client.source(id);
      if (disposed || selected?.id !== id || current !== sourceVersion) return;
      source = next;
      const previousFile = file.value;
      file.replaceChildren();
      for (const path of Object.keys(next.files).sort()) {
        const option = document.createElement('option'); option.value = path; option.textContent = path; file.append(option);
      }
      file.value = Object.hasOwn(next.files, previousFile) ? previousFile : Object.hasOwn(next.files, 'src/App.tsx') ? 'src/App.tsx' : file.options[0]?.value ?? '';
      code.textContent = next.files[file.value] ?? 'No source files yet.';
    } catch (cause) {
      if (!disposed && selected?.id === id && current === sourceVersion) {
        code.textContent = 'Could not load source.';
        reportError(cause, () => loadSource());
      }
    } finally {
      if (current === sourceVersion) node<HTMLElement>('#build-code-panel').setAttribute('aria-busy', 'false');
    }
  }

  function setTab(tab: HTMLButtonElement, focus = false) {
    for (const button of tabs) {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      node<HTMLElement>(`#${button.getAttribute('aria-controls')}`).hidden = !active;
    }
    if (tab.id === 'build-code-tab') void loadSource();
    if (focus) tab.focus();
  }

  function schedule() {
    clearTimeout(timer);
    if (disposed || busy || !loaded || document.hidden || stopWatching) return;
    const active = selected ? selected.activeTurnId : apps.some(app => app.activeTurnId);
    timer = setTimeout(() => void refresh(), active ? 2500 : 15000);
  }
  async function refresh() {
    if (disposed || busy || refreshing || document.hidden) return;
    refreshing = true; clearTimeout(timer);
    const current = version, id = selected?.id;
    try {
      if (id) {
        const { app } = await client.read(id);
        if (disposed || current !== version || selected?.id !== id) return;
        const changed = selected?.revision !== app.revision || Boolean(selected?.activeTurnId && !app.activeTurnId);
        renderApp(app);
        if (changed && tabs[1].getAttribute('aria-selected') === 'true') void loadSource();
      } else {
        const result = await client.list();
        if (disposed || current !== version || selected) return;
        if (JSON.stringify(apps) !== JSON.stringify(result.apps)) { apps = result.apps; renderList(); }
      }
    } catch (cause) {
      if (!disposed && current === version) reportError(cause, () => refresh());
    } finally { refreshing = false; if (current === version) schedule(); }
  }

  async function mutate<T>(operation: () => Promise<T>, apply: (result: T) => void, pendingPrompt?: string) {
    if (busy || disposed) return;
    busy = true; const current = ++version;
    clearTimeout(timer); clearError(); controls();
    if (pendingPrompt) renderPending(pendingPrompt);
    let succeeded = false;
    try {
      const result = await operation();
      if (!disposed && current === version) { optimistic = null; apply(result); succeeded = true; }
    } catch (cause) {
      if (!disposed && current === version) reportError(cause, cause instanceof BuildAPIError && ['revision_conflict', 'build_busy'].includes(cause.code)
        ? () => refresh() : () => mutate(operation, apply, pendingPrompt));
    } finally {
      if (!disposed && current === version) {
        busy = false;
        if (optimistic) {
          const pending = optimistic; optimistic = null; conversationKey = '';
          if (pending.newApp) { home.hidden = false; workspace.hidden = true; progress.hidden = true; }
          else if (selected) renderApp(selected);
        }
        controls(); watchApp(); schedule();
        if (succeeded && document.activeElement === document.body) (selected ? update : prompt).focus();
      }
    }
  }
  async function openApp(id: string) {
    if (busy || disposed) return;
    if (update.value.trim() && !window.confirm('Leave this app without sending your changes?')) return;
    await mutate(() => client.read(id), ({ app }) => {
      update.value = ''; source = null; sourceVersion++; conversationKey = '';
      setAppURL(id); renderApp(app); setTab(tabs[0]); update.focus();
    });
  }

  node<HTMLFormElement>('#build-create-form').addEventListener('submit', event => {
    event.preventDefault();
    if (create.disabled) return;
    const text = prompt.value.trim(), key = submissionKey(JSON.stringify(['create', text]));
    void mutate(() => client.create(text, key), ({ app }) => {
      clearSubmission(key); prompt.value = ''; conversationKey = ''; setAppURL(app.id); renderApp(app); setTab(tabs[0]); update.focus();
    }, text);
  });
  node<HTMLFormElement>('#build-update-form').addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled || !selected) return;
    const app = selected, text = update.value.trim(), key = submissionKey(JSON.stringify(['build', app.id, app.revision, text]));
    void mutate(() => client.turn(app, text, key), ({ app: next }) => {
      clearSubmission(key); update.value = ''; renderApp(next); update.focus();
    }, text);
  });
  node<HTMLButtonElement>('#build-start-preview').addEventListener('click', () => {
    if (!selected) return;
    const app = selected, key = submissionKey(JSON.stringify(['preview', app.id, app.revision]));
    void mutate(() => client.preview(app, key), ({ app: next }) => { clearSubmission(key); renderApp(next); });
  });
  node<HTMLButtonElement>('#build-resume').addEventListener('click', () => {
    if (selected) void mutate(() => client.resume(selected!.id), ({ app }) => renderApp(app));
  });
  node<HTMLButtonElement>('#build-stop').addEventListener('click', () => {
    if (!selected || !window.confirm('Stop this sandbox? Its preview will go offline. Your source and conversation stay saved.')) return;
    void mutate(() => client.stop(selected!.id), ({ app }) => renderApp(app));
  });
  name.addEventListener('change', () => {
    if (!selected) return;
    const text = name.value.trim();
    if (!text) { name.value = selected.name; return; }
    if (text === selected.name) return;
    const id = selected.id;
    void mutate(() => client.rename(id, text), ({ app }) => { renderApp(app); status.textContent = 'App renamed'; });
  });
  node<HTMLButtonElement>('#build-export').addEventListener('click', () => {
    if (!selected) return;
    const app = selected;
    void mutate(() => client.export(app.id), blob => {
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'}-source.zip`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = 'Source downloaded';
    });
  });
  node<HTMLButtonElement>('#build-back').addEventListener('click', () => {
    if (busy || update.value.trim() && !window.confirm('Leave this app without sending your changes?')) return;
    version++; sourceVersion++; selected = null; source = null; update.value = '';
    disconnectStream();
    frame.removeAttribute('src'); setAppURL(null); clearError();
    workspace.hidden = true; home.hidden = false; renderList(); prompt.focus();
    void refresh();
  });
  for (const textarea of [prompt, update]) {
    textarea.addEventListener('input', controls);
    textarea.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey) return;
      event.preventDefault(); textarea.form?.requestSubmit();
    });
  }
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-build-example]')) {
    button.addEventListener('click', () => {
      if (prompt.value.trim() && !window.confirm('Replace your current idea with this example?')) return;
      prompt.value = buildExamples[button.dataset.buildExample!] ?? ''; controls(); prompt.focus();
    });
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => setTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[next], true);
    });
  }
  file.addEventListener('change', () => { code.textContent = source?.files[file.value] ?? ''; });
  retry.addEventListener('click', () => { const action = retryAction; clearError(); void action?.(); });

  function loadLocalBriefs(id: string) {
    const section = node<HTMLElement>('#build-local-drafts'), local = node<HTMLElement>('#build-local-list');
    local.replaceChildren();
    try {
      const drafts = createBuildDraftStore(localStorage, id).read();
      section.hidden = drafts.length === 0;
      for (const draft of drafts) {
        const row = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'build-draft-open'; button.textContent = draft.name;
        button.addEventListener('click', () => {
          if (prompt.value.trim() && !window.confirm('Replace your current idea with this saved brief?')) return;
          const brief = draft.messages.map(message => message.text).join('\n\n');
          if (brief.length > prompt.maxLength) {
            reportError(new Error('This brief is too long. Start with its first idea, then send the remaining changes separately.'), () => { prompt.value = draft.messages[0].text; controls(); prompt.focus(); });
            return;
          }
          prompt.value = brief; controls(); prompt.focus();
        });
        row.append(button); local.append(row);
      }
    } catch { section.hidden = true; /* Legacy storage cannot block account-backed apps. */ }
  }

  async function load(id: string) {
    if (disposed || busy) return;
    userId = id;
    const current = ++version;
    busy = true; clearTimeout(timer); clearError(); controls();
    host.setAttribute('aria-busy', 'true');
    const results = await Promise.allSettled([client.config(), client.list()]);
    if (disposed || current !== version) return;
    const [configuration, listing] = results;
    config = configuration.status === 'fulfilled' ? configuration.value : null;
    if (listing.status === 'fulfilled') { apps = listing.value.apps; loaded = true; renderList(); }
    node<HTMLElement>('#build-availability').textContent = configuration.status === 'rejected' ? 'Could not check Build availability.'
      : !config?.available ? 'Build is unavailable right now. Your saved apps and source remain accessible.'
        : 'AI included during beta · Preview runtime uses your prepaid balance.';
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') reportError(failure.reason, () => load(id));
    loadLocalBriefs(id);
    busy = false; host.setAttribute('aria-busy', 'false'); controls();
    const appId = new URL(location.href).searchParams.get('app');
    if (appId && !selected) await openApp(appId);
    schedule();
  }

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (disposed || !(prompt.value.trim() || update.value.trim() || selected && name.value.trim() !== selected.name)) return;
    event.preventDefault(); event.returnValue = '';
  };
  const visibility = () => { if (document.hidden) { clearTimeout(timer); disconnectStream(); } else { void refresh(); } };
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('visibilitychange', visibility);
  function dispose() {
    disposed = true; version++; sourceVersion++; controller.abort(); clearTimeout(timer);
    disconnectStream(); optimistic = null;
    apps = []; selected = null; source = null; config = null; pendingSubmission = null;
    prompt.value = ''; update.value = ''; name.value = ''; messages.replaceChildren(); list.replaceChildren();
    node<HTMLElement>('#build-local-list').replaceChildren(); code.textContent = ''; node<HTMLElement>('#build-logs').textContent = '';
    frame.removeAttribute('src'); openPreview.removeAttribute('href'); controls();
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('visibilitychange', visibility);
  }
  controls();
  return { load, dispose };
}
