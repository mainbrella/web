import { BuildAPIError, buildErrorMessage, createBuildClient, safeBuildPreviewURL, type BuildActivity, type BuildImage, type BuildApp, type BuildConfig, type BuildSource, type BuildTurn } from './build-api.ts';
import { buildExamples, createBuildDraftStore } from './build-drafts.ts';
import { buildBriefQuestions, formatBuildBriefPrompt, readBuildBriefPrompt } from './build-brief.ts';

type Clarification = { prompt: string; answers: [string, string]; step: 0 | 1 };

export function createBuildDashboard({ onUnauthenticated }: { onUnauthenticated: () => void }) {
  const host = document.querySelector<HTMLElement>('#dashboard-build')!;
  const node = <T extends HTMLElement>(selector: string) => (host.querySelector<T>(selector) ?? document.querySelector<T>(selector))!;
  const home = node<HTMLElement>('#build-home');
  const workspace = node<HTMLElement>('#build-workspace');
  const panels = node<HTMLElement>('.build-workspace-panels');
  const prompt = node<HTMLTextAreaElement>('#build-prompt');
  const create = node<HTMLButtonElement>('#build-create');
  const update = node<HTMLTextAreaElement>('#build-update');
  const send = node<HTMLButtonElement>('#build-update-save');
  const name = node<HTMLInputElement>('#build-draft-name');
  const list = node<HTMLElement>('#build-draft-list');
  const messages = node<HTMLElement>('#build-messages');
  const conversationScroll = node<HTMLElement>('#build-conversation-scroll');
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
  const questions = node<HTMLFormElement>('#build-questions');
  const questionTitle = node<HTMLElement>('#build-question-title');
  const customAnswer = node<HTMLInputElement>('#build-question-custom');
  const questionNext = node<HTMLButtonElement>('#build-question-next');
  const questionBack = node<HTMLButtonElement>('#build-question-back');
  const questionSkip = node<HTMLButtonElement>('#build-question-skip');
  const togglePreview = node<HTMLButtonElement>('#build-toggle-preview');
  const mobile = window.matchMedia('(max-width: 900px)');
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
  let clarification: Clarification | null = null;
  let previewPreference: boolean | null = null;
  let mobileView: 'conversation' | 'preview' = 'conversation';

  const heading = node<HTMLElement>('.build-workspace-heading');
  const header = document.querySelector<HTMLElement>('.app-header')!;
  const navigation = document.querySelector<HTMLElement>('.app-navigation')!;
  const menu = document.createElement('details'), menuToggle = document.createElement('summary'), menuPanel = document.createElement('div');
  menu.className = 'build-navigation'; menuToggle.textContent = 'Build'; menuToggle.setAttribute('aria-label', 'Build and account navigation');
  menuPanel.className = 'build-navigation-panel';
  menuPanel.append(navigation, document.querySelector<HTMLElement>('.dashboard-subscription')!);
  // Keep the existing navigation and billing controls in one compact header.
  const accountNav = header.querySelector<HTMLElement>('nav')!;
  for (const link of accountNav.querySelectorAll<HTMLAnchorElement>(':scope > a')) navigation.append(link);
  menu.append(menuToggle, menuPanel); header.querySelector('.brand')!.after(menu, heading);
  node<HTMLElement>('.build-more-actions').prepend(node<HTMLButtonElement>('#build-start-preview'), node<HTMLButtonElement>('#build-resume'));
  header.classList.add('build-header');
  const closeNavigation = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) menu.open = false; };
  document.addEventListener('click', closeNavigation);
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; menuToggle.focus(); } });
  navigation.addEventListener('click', () => { menu.open = false; });

  function layout() {
    heading.hidden = workspace.hidden;
    const visible = previewPreference ?? Boolean(selected?.revision || selected?.preview);
    panels.classList.toggle('has-preview', visible);
    panels.dataset.mobileView = mobileView;
    togglePreview.hidden = !selected;
    const expanded = visible && (!mobile.matches || mobileView === 'preview');
    togglePreview.textContent = mobile.matches ? expanded ? 'Conversation' : 'Preview' : visible ? 'Hide preview' : 'Show preview';
    togglePreview.setAttribute('aria-expanded', String(expanded));
  }

  function controls() {
    const locked = busy || disposed;
    const active = apps.some(app => app.activeTurnId) || Boolean(selected?.activeTurnId);
    const available = config?.available && loaded && !active;
    create.disabled = locked || !available || !prompt.value.trim() || apps.length >= (config?.maxApps ?? 50);
    send.disabled = locked || !available || !(selected || clarification) || !update.value.trim();
    create.setAttribute('aria-label', busy && !selected ? 'Starting build' : 'Start building');
    send.setAttribute('aria-label', busy ? 'Sending message' : 'Send message');
    for (const input of [prompt, update]) input.disabled = locked;
    name.disabled = locked || Boolean(clarification);
    for (const button of [...heading.querySelectorAll<HTMLButtonElement>('button'), ...host.querySelectorAll<HTMLButtonElement>('.build-draft-open, .build-draft-delete')]) button.disabled = locked;
    node<HTMLButtonElement>('#build-stop').disabled = locked || Boolean(selected?.activeTurnId);
    node<HTMLButtonElement>('#build-start-preview').disabled = locked || !available;
    node<HTMLButtonElement>('#build-resume').disabled = locked || !config?.available;
    retry.disabled = locked;
    create.title = active ? 'A build is already running in your account.' : apps.length >= (config?.maxApps ?? 50) ? 'Delete an app to make room.' : '';
    send.title = active ? 'You can write your next change while Build works.' : '';
    node<HTMLElement>('.build-more').hidden = !selected;
    const canCreate = !locked && available && apps.length < (config?.maxApps ?? 50);
    questionNext.disabled = !canCreate || !clarification?.answers[clarification.step].trim();
    questionSkip.disabled = !canCreate;
    questionBack.disabled = locked || clarification?.step !== 1;
    for (const input of questions.querySelectorAll<HTMLInputElement>('input')) input.disabled = locked;
    layout();
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

  function saveClarification() {
    try {
      const key = `mainbrella-build-brief:v1:${userId}`;
      if (clarification) sessionStorage.setItem(key, JSON.stringify(clarification));
      else sessionStorage.removeItem(key);
    } catch { /* The in-memory brief still works without browser storage. */ }
  }
  function restoreClarification() {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(`mainbrella-build-brief:v1:${userId}`) || 'null');
      if (!saved || typeof saved !== 'object') return;
      const brief = saved as Clarification;
      if (typeof brief.prompt !== 'string' || !brief.prompt.trim() || brief.prompt.length > 6000
        || !Array.isArray(brief.answers) || brief.answers.length !== 2
        || !brief.answers.every(answer => typeof answer === 'string' && answer.length <= 180)
        || brief.step !== 0 && brief.step !== 1) return;
      prompt.value = brief.prompt;
      beginClarification(brief);
    } catch { /* Invalid or unavailable storage cannot block building. */ }
  }
  function clearClarification() {
    clarification = null; questions.hidden = true; workspace.classList.remove('is-clarifying');
    update.placeholder = 'Ask for a change…';
    saveClarification();
  }
  function renderQuestions(focus = true) {
    if (!clarification) return;
    const brief = clarification, question = buildBriefQuestions[brief.step];
    questionTitle.textContent = question.title;
    node<HTMLElement>('#build-question-step').textContent = `${brief.step + 1} of 2`;
    questionNext.textContent = brief.step === 0 ? 'Next' : 'Build app';
    node<HTMLElement>('#build-question-error').hidden = true;
    const options = node<HTMLElement>('#build-question-options');
    options.replaceChildren(); options.classList.toggle('is-palette', brief.step === 1);
    const answer = brief.answers[brief.step];
    customAnswer.value = question.options.some(option => option.value === answer) ? '' : answer;
    for (const option of question.options) {
      const label = document.createElement('label'), radio = document.createElement('input');
      label.className = option.colors ? 'build-style-option' : 'build-question-option';
      radio.type = 'radio'; radio.name = 'build-question-answer'; radio.value = option.value; radio.checked = answer === option.value;
      const copy = document.createElement('span'), title = document.createElement('strong');
      copy.className = 'build-option-copy'; title.textContent = option.value; copy.append(title);
      if (option.description) {
        const description = document.createElement('span'); description.textContent = option.description; copy.append(description);
      }
      label.append(radio, copy);
      if (option.colors) {
        const swatches = document.createElement('span'); swatches.className = 'build-swatches'; swatches.setAttribute('aria-hidden', 'true');
        for (const color of option.colors) {
          const swatch = document.createElement('span'); swatch.style.setProperty('--swatch', color); swatches.append(swatch);
        }
        label.append(swatches);
      }
      radio.addEventListener('change', () => {
        if (clarification !== brief) return;
        brief.answers[brief.step] = option.value; customAnswer.value = ''; saveClarification(); controls();
      });
      options.append(label);
    }
    questions.hidden = false; saveClarification(); controls();
    if (focus) questionTitle.focus();
  }
  function beginClarification(brief: Clarification) {
    clarification = brief; selected = null; previewPreference = null; mobileView = 'conversation';
    home.hidden = true; workspace.hidden = false; workspace.classList.add('is-clarifying');
    workspace.classList.remove('is-building');
    name.value = brief.prompt.split(/\r?\n/)[0].slice(0, 64);
    progress.hidden = true; status.textContent = ''; conversationKey = '';
    frame.removeAttribute('src'); frame.hidden = true; openPreview.hidden = true;
    for (const id of ['start-preview', 'stop', 'resume']) node<HTMLButtonElement>(`#build-${id}`).hidden = true;
    messages.replaceChildren(messageRow(brief.prompt), messageRow('A couple of details will help shape your app. You can also skip ahead and build.', 'build-message-intro', 'Build'));
    messages.setAttribute('aria-busy', 'false');
    update.value = ''; update.placeholder = 'Add more detail, or tell Build what to do instead…';
    renderQuestions();
  }
  function submitNewApp(text: string) {
    const key = submissionKey(JSON.stringify(['create', text]));
    void mutate(() => client.create(text, key), ({ app }) => {
      clearSubmission(key); clearClarification(); prompt.value = ''; update.value = ''; conversationKey = '';
      setAppURL(app.id); renderApp(app); setTab(tabs[0]); update.focus();
    }, text);
  }
  function submitBrief(answers: readonly string[], extra = '') {
    if (!clarification || questionSkip.disabled) return;
    try {
      const text = formatBuildBriefPrompt(clarification.prompt + (extra ? `\n\n${extra}` : ''), answers);
      submitNewApp(text);
    } catch (cause) {
      const error = node<HTMLElement>('#build-question-error');
      error.textContent = cause instanceof Error ? cause.message : 'Check your brief and try again.'; error.hidden = false;
    }
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
      const excerpt = document.createElement('span'); excerpt.textContent = readBuildBriefPrompt(app.prompt).prompt;
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

  function messageRow(text: string, className = 'build-message-user', label = 'You') {
    const row = document.createElement('li'), author = document.createElement('span'), paragraph = document.createElement('p');
    row.className = className; author.textContent = label; paragraph.textContent = text;
    row.append(author, paragraph);
    return row;
  }

  function appendBriefAnswers(body: HTMLElement, answers: readonly string[]) {
    if (!answers.some(Boolean)) return;
    const definitions = document.createElement('dl'); definitions.className = 'build-brief-answers';
    for (const [index, label] of ['App type', 'Visual style'].entries()) {
      if (!answers[index]) continue;
      const term = document.createElement('dt'), value = document.createElement('dd');
      term.textContent = label; value.textContent = answers[index]; definitions.append(term, value);
    }
    body.append(definitions);
  }

  function activityRow(turn: BuildTurn, existing?: HTMLElement) {
    const row = existing ?? document.createElement('li');
    row.className = 'build-activity-message';
    let details = row.querySelector<HTMLDetailsElement>('details');
    if (!details) {
      details = document.createElement('details'); details.className = 'build-activity';
      const summary = document.createElement('summary');
      for (const className of ['build-activity-state', 'build-activity-title', 'build-activity-count']) {
        const span = document.createElement('span'); span.className = className; summary.append(span);
      }
      const body = document.createElement('div'); body.className = 'build-activity-body';
      details.append(summary, body); row.append(details);
    }
    const running = turn.status === 'running' || turn.status === 'queued';
    details.dataset.state = running ? 'running' : turn.status;
    const state = details.querySelector<HTMLElement>('.build-activity-state')!;
    state.textContent = running ? '⋯' : turn.status === 'failed' ? '!' : '✓';
    state.setAttribute('aria-label', running ? 'In progress' : turn.status === 'failed' ? 'Failed' : 'Completed');
    details.querySelector<HTMLElement>('.build-activity-title')!.textContent = running ? turn.stage || 'Starting build…'
      : turn.status === 'failed' ? 'Build needs attention' : turn.mode === 'preview' ? 'Preview ready' : 'Built app';
    const tools = (turn.activity ?? []).filter(item => item.type === 'tool');
    details.querySelector<HTMLElement>('.build-activity-count')!.textContent = tools.length ? `${tools.length} ${tools.length === 1 ? 'step' : 'steps'}` : '';
    const body = details.querySelector<HTMLElement>('.build-activity-body')!; body.replaceChildren();
    appendBriefAnswers(body, readBuildBriefPrompt(turn.prompt).answers);
    const activity = document.createElement('ul'); activity.className = 'build-activity-list';
    for (const item of tools) {
      const state = item.status === 'running' && turn.status === 'failed' ? 'failed' : item.status;
      const entry = document.createElement('li'), icon = document.createElement('span'), text = document.createElement('p');
      entry.className = `build-tool build-tool-${state}`;
      icon.textContent = state === 'running' ? '⋯' : state === 'failed' ? '!' : '✓';
      icon.setAttribute('aria-label', state === 'running' ? 'In progress' : state === 'failed' ? 'Failed' : 'Completed');
      text.textContent = item.text; entry.append(icon, text); activity.append(entry);
    }
    if (tools.length) body.append(activity);
    if (!body.children.length) {
      const text = document.createElement('p'); text.textContent = turn.stage || 'Waiting for build activity…'; body.append(text);
    }
    return row;
  }

  function imageRow(appId: string, image: BuildImage | undefined, activity: BuildActivity | undefined, existing?: HTMLElement) {
    const row = existing ?? document.createElement('li'); row.className = 'build-image-message';
    const url = image && client.imageURL(appId, image.id);
    const label = image?.label ?? activity?.text ?? '';
    if (existing && row.dataset.imageLabel === label && (image ? row.dataset.imageId === image.id : row.dataset.imageState === activity?.status)) return row;
    row.dataset.imageId = image?.id ?? ''; row.dataset.imageState = activity?.status ?? ''; row.dataset.imageLabel = label;
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    if (url && image) {
      const link = document.createElement('a'), img = document.createElement('img');
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open generated image: ${image.label}`);
      img.alt = image.label; img.width = 768; img.height = 512; img.decoding = 'async'; img.loading = 'lazy'; img.src = url;
      caption.textContent = image.label;
      const feedback = document.createElement('span'); feedback.className = 'build-image-feedback'; feedback.textContent = 'Loading image…';
      img.addEventListener('load', () => { feedback.hidden = true; });
      img.addEventListener('error', () => { feedback.textContent = 'Image unavailable. Open the image to try again.'; });
      link.append(img); figure.append(link, caption, feedback);
    } else {
      const pending = activity?.status === 'running';
      if (pending) {
        const placeholder = document.createElement('div'); placeholder.className = 'build-image-pending'; placeholder.setAttribute('aria-hidden', 'true'); figure.append(placeholder);
      }
      caption.textContent = pending ? `${activity!.text.replace(/^Generate /, 'Generating ')}…` : 'Could not generate this image. Build can continue.';
      caption.setAttribute('role', 'status'); figure.append(caption);
    }
    row.replaceChildren(figure);
    return row;
  }

  function renderConversation(app: BuildApp) {
    const key = JSON.stringify(app.turns);
    if (key === conversationKey) return;
    conversationKey = key;
    const nearBottom = conversationScroll.scrollHeight - conversationScroll.scrollTop - conversationScroll.clientHeight < 80;
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
      message(`user-${turn.id}`, 'You', turn.mode === 'preview' ? 'Restart the preview from saved source.' : readBuildBriefPrompt(turn.prompt).prompt, 'build-message-user');
      for (const item of turn.activity ?? []) {
        if (item.type === 'message') message(`${turn.id}-${item.id}`, 'Build', item.text, item.status === 'running' && app.activeTurnId === turn.id ? 'build-message-streaming' : '');
      }
      const imageTools = (turn.activity ?? []).filter(item => item.type === 'tool' && item.text.startsWith('Generate '));
      const imageIds = new Set(imageTools.map(item => item.id));
      for (const tool of imageTools) {
        const key = `image-${turn.id}-${tool.id}`, image = turn.images?.find(image => image.toolId === tool.id);
        const row = imageRow(app.id, image, { ...tool, status: tool.status === 'running' && turn.status === 'failed' ? 'failed' : tool.status }, existing.get(key));
        row.dataset.messageKey = key; rows.push(row);
      }
      for (const image of turn.images ?? []) {
        if (imageIds.has(image.toolId)) continue;
        const key = `image-${turn.id}-${image.toolId}`, row = imageRow(app.id, image, undefined, existing.get(key));
        row.dataset.messageKey = key; rows.push(row);
      }
      const activityKey = `activity-${turn.id}`, activity = activityRow(turn, existing.get(activityKey));
      activity.dataset.messageKey = activityKey; rows.push(activity);
      if (turn.status === 'failed') message(`result-${turn.id}`, 'Build', buildErrorMessage(turn.error || 'build_failed'), 'build-message-error');
      else if (turn.summary && !turn.activity?.some(item => item.type === 'message' && item.text === turn.summary)) message(`result-${turn.id}`, 'Build', turn.summary);
      else if (!turn.activity?.length && turn.status === 'succeeded') message(`result-${turn.id}`, 'Build', turn.stage);
    }
    for (const row of Array.from(messages.children)) if (!rows.includes(row as HTMLElement)) row.remove();
    rows.forEach((row, index) => { if (messages.children[index] !== row) messages.insertBefore(row, messages.children[index] ?? null); });
    if (nearBottom) conversationScroll.scrollTop = conversationScroll.scrollHeight;
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
    node<HTMLButtonElement>('#build-refresh-preview').hidden = !url;
    if (url) {
      openPreview.href = url;
      if (frame.getAttribute('src') !== url) frame.src = url;
      previewStatus.textContent = `Temporary preview · expires ${new Date(preview!.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      openPreview.title = previewStatus.textContent;
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
    progress.hidden = !app.activeTurnId;
    progress.classList.add('visually-hidden');
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
    questions.hidden = true; workspace.classList.remove('is-clarifying');
    if (!selected) {
      home.hidden = true; workspace.hidden = false;
      name.value = readBuildBriefPrompt(text).prompt.split(/\r?\n/)[0].slice(0, 64);
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
    messages.append(messageRow(readBuildBriefPrompt(text).prompt));
    conversationScroll.scrollTop = conversationScroll.scrollHeight;
    progress.hidden = false; progress.textContent = 'Sending your request…';
    progress.classList.remove('visually-hidden');
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
          if (pending.newApp && clarification) {
            const unsent = update.value; beginClarification(clarification); update.value = unsent;
          } else if (pending.newApp) { home.hidden = false; workspace.hidden = true; progress.hidden = true; }
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
      clearClarification(); previewPreference = null; mobileView = 'conversation';
      update.value = ''; source = null; sourceVersion++; conversationKey = '';
      setAppURL(id); renderApp(app); setTab(tabs[0]); update.focus();
    });
  }

  node<HTMLFormElement>('#build-create-form').addEventListener('submit', event => {
    event.preventDefault();
    if (create.disabled) return;
    beginClarification({ prompt: prompt.value.trim(), answers: ['', ''], step: 0 });
  });
  node<HTMLFormElement>('#build-update-form').addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled) return;
    if (clarification) { submitBrief(clarification.answers, update.value.trim()); return; }
    if (!selected) return;
    const app = selected, text = update.value.trim(), key = submissionKey(JSON.stringify(['build', app.id, app.revision, text]));
    void mutate(() => client.turn(app, text, key), ({ app: next }) => {
      clearSubmission(key); update.value = ''; renderApp(next); update.focus();
    }, text);
  });
  questions.addEventListener('submit', event => {
    event.preventDefault();
    if (!clarification || questionNext.disabled) return;
    if (clarification.step === 0) { clarification.step = 1; renderQuestions(); }
    else submitBrief(clarification.answers);
  });
  questionBack.addEventListener('click', () => {
    if (!clarification || questionBack.disabled) return;
    clarification.step = 0; renderQuestions();
  });
  questionSkip.addEventListener('click', () => submitBrief(['', '']));
  customAnswer.addEventListener('input', () => {
    if (!clarification) return;
    clarification.answers[clarification.step] = customAnswer.value.trim();
    for (const radio of questions.querySelectorAll<HTMLInputElement>('input[type="radio"]')) radio.checked = false;
    node<HTMLElement>('#build-question-error').hidden = true;
    saveClarification(); controls();
  });
  togglePreview.addEventListener('click', () => {
    if (mobile.matches) {
      previewPreference = true;
      mobileView = mobileView === 'conversation' ? 'preview' : 'conversation';
    } else previewPreference = !panels.classList.contains('has-preview');
    layout();
    if (mobile.matches && mobileView === 'conversation') update.focus();
  });
  const resizeWorkspace = () => layout();
  mobile.addEventListener('change', resizeWorkspace);
  for (const device of ['desktop', 'mobile']) {
    node<HTMLButtonElement>(`#build-device-${device}`).addEventListener('click', () => {
      node<HTMLElement>('#build-preview-panel').classList.toggle('is-mobile', device === 'mobile');
      for (const choice of ['desktop', 'mobile']) node<HTMLElement>(`#build-device-${choice}`).setAttribute('aria-pressed', String(choice === device));
    });
  }
  node<HTMLButtonElement>('#build-refresh-preview').addEventListener('click', () => {
    const preview = selected?.preview;
    const url = preview && preview.expiresAt > Date.now() && safeBuildPreviewURL(preview.url);
    if (url) frame.src = url;
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
    clearClarification(); previewPreference = null; mobileView = 'conversation';
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
    else if (!appId && !selected && !clarification) restoreClarification();
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
    apps = []; selected = null; source = null; config = null; pendingSubmission = null; clarification = null;
    prompt.value = ''; update.value = ''; name.value = ''; messages.replaceChildren(); list.replaceChildren();
    node<HTMLElement>('#build-local-list').replaceChildren(); code.textContent = ''; node<HTMLElement>('#build-logs').textContent = '';
    frame.removeAttribute('src'); openPreview.removeAttribute('href'); controls();
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('visibilitychange', visibility);
    mobile.removeEventListener('change', resizeWorkspace);
    document.removeEventListener('click', closeNavigation);
  }
  controls();
  return { load, dispose };
}
