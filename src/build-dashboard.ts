import { buildExamples, createBuildDraftStore, formatBuildBrief, maxBuildDrafts, maxBuildMessages, newBuildDraft, type BuildDraft } from './build-drafts.ts';

export function createBuildDashboard() {
  const host = document.querySelector<HTMLElement>('#dashboard-build')!;
  const node = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const home = node<HTMLElement>('#build-home');
  const workspace = node<HTMLElement>('#build-workspace');
  const prompt = node<HTMLTextAreaElement>('#build-prompt');
  const create = node<HTMLButtonElement>('#build-create');
  const update = node<HTMLTextAreaElement>('#build-update');
  const add = node<HTMLButtonElement>('#build-update-save');
  const name = node<HTMLInputElement>('#build-draft-name');
  const list = node<HTMLElement>('#build-draft-list');
  const messages = node<HTMLElement>('#build-messages');
  const error = node<HTMLElement>('#build-storage-error');
  const status = node<HTMLElement>('#build-save-status');
  const previewTab = node<HTMLButtonElement>('#build-preview-tab');
  const briefTab = node<HTMLButtonElement>('#build-brief-tab');
  let store: ReturnType<typeof createBuildDraftStore> | null = null;
  let drafts: BuildDraft[] = [];
  let selected: BuildDraft | null = null;
  let userId: string | null = null;
  let disposed = false;

  function controls() {
    create.disabled = !store || !prompt.value.trim() || drafts.length >= maxBuildDrafts;
    add.disabled = !store || !selected || !update.value.trim() || selected.messages.length >= maxBuildMessages;
    create.title = drafts.length >= maxBuildDrafts ? 'Delete a draft to make room for a new one.' : '';
    if (selected && selected.messages.length >= maxBuildMessages) status.textContent = 'This brief has reached its 100-entry limit.';
  }

  function reportError(text: string) {
    error.textContent = text;
    error.hidden = false;
  }

  function save(next: BuildDraft[]) {
    if (disposed || !store) return false;
    try {
      // Merge this change with drafts saved in another tab before writing.
      const saved = store.read();
      const deleted = drafts.filter(draft => !next.some(item => item.id === draft.id)).map(draft => draft.id);
      const changed = next.filter(draft => !drafts.includes(draft));
      const merged = saved.filter(draft => !deleted.includes(draft.id) && !changed.some(item => item.id === draft.id));
      for (const draft of changed) {
        const earlier = drafts.find(item => item.id === draft.id);
        const current = saved.find(item => item.id === draft.id);
        if (earlier && JSON.stringify(earlier) !== JSON.stringify(current)) throw new Error('draft_changed');
        merged.push(draft);
      }
      store.save(merged);
      drafts = merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      error.hidden = true;
      renderList();
      return true;
    } catch (caught) {
      reportError(caught instanceof Error && caught.message === 'draft_changed'
        ? 'This draft changed in another tab. Export your brief before reloading to see the latest version.'
        : selected
          ? 'Could not save your draft in this browser. Your changes are still here; try again or export your brief.'
          : 'Could not save your draft in this browser. Your idea is still here; check browser storage and try again.');
      return false;
    }
  }

  function renderList() {
    list.replaceChildren();
    node<HTMLElement>('#build-empty').hidden = drafts.length > 0;
    for (const draft of drafts) {
      const row = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'build-draft-open';
      const title = document.createElement('strong');
      title.textContent = draft.name;
      const excerpt = document.createElement('span');
      excerpt.textContent = draft.messages[0].text;
      const meta = document.createElement('span');
      meta.className = 'build-draft-meta';
      meta.textContent = `Draft · ${new Date(draft.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      open.append(title, excerpt, meta);
      open.addEventListener('click', () => openDraft(draft));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'build-draft-delete';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${draft.name}`);
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete “${draft.name}”? This removes its saved brief from this browser.`)) return;
        if (save(drafts.filter(item => item.id !== draft.id))) {
          controls();
          (list.querySelector<HTMLButtonElement>('button') ?? prompt).focus();
        }
      });
      row.append(open, remove);
      list.append(row);
    }
    controls();
  }

  function renderBrief() {
    if (!selected) return;
    node<HTMLElement>('#build-brief-title').textContent = selected.name;
    const brief = node<HTMLElement>('#build-brief-content');
    brief.replaceChildren();
    messages.replaceChildren();
    selected.messages.forEach((message, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = index === 0 ? 'Initial brief' : `Update ${index}`;
      const text = document.createElement('p');
      text.textContent = message.text;
      row.append(label, text);
      messages.append(row);
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = label.textContent;
      const paragraph = document.createElement('p');
      paragraph.textContent = message.text;
      section.append(heading, paragraph);
      brief.append(section);
    });
    messages.scrollTop = messages.scrollHeight;
    controls();
  }

  function setPreviewTab(tab: HTMLButtonElement, focus = false) {
    const preview = tab === previewTab;
    for (const button of [previewTab, briefTab]) {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    node<HTMLElement>('#build-preview-panel').hidden = !preview;
    node<HTMLElement>('#build-brief-panel').hidden = preview;
    if (focus) tab.focus();
  }

  function openDraft(draft: BuildDraft) {
    selected = draft;
    home.hidden = true;
    workspace.hidden = false;
    name.value = draft.name;
    update.value = '';
    status.textContent = 'Saved in this browser';
    setPreviewTab(previewTab);
    renderBrief();
    update.focus();
  }

  node<HTMLButtonElement>('#build-back').addEventListener('click', () => {
    if ((update.value.trim() || (selected && name.value.trim() !== selected.name))
      && !window.confirm('Leave this draft without saving your latest changes?')) return;
    workspace.hidden = true;
    home.hidden = false;
    selected = null;
    update.value = '';
    renderList();
    prompt.focus();
  });

  node<HTMLFormElement>('#build-create-form').addEventListener('submit', event => {
    event.preventDefault();
    if (create.disabled || !prompt.value.trim()) return;
    const draft = newBuildDraft(prompt.value);
    if (!save([draft, ...drafts])) return;
    prompt.value = '';
    openDraft(draft);
  });
  node<HTMLFormElement>('#build-update-form').addEventListener('submit', event => {
    event.preventDefault();
    if (add.disabled || !selected || !update.value.trim()) return;
    const now = new Date().toISOString();
    const next = { ...selected, name: name.value.trim() || selected.name, updatedAt: now, messages: [...selected.messages, { text: update.value.trim(), createdAt: now }] };
    if (!save(drafts.map(draft => draft.id === next.id ? next : draft))) return;
    selected = next;
    update.value = '';
    status.textContent = 'Brief updated';
    renderBrief();
    update.focus();
  });
  name.addEventListener('change', () => {
    if (!selected) return;
    const text = name.value.trim();
    if (!text) { name.value = selected.name; return; }
    if (text === selected.name) return;
    const next = { ...selected, name: text, updatedAt: new Date().toISOString() };
    if (!save(drafts.map(draft => draft.id === next.id ? next : draft))) return;
    selected = next;
    status.textContent = 'Draft renamed';
    renderBrief();
  });
  for (const textarea of [prompt, update]) {
    textarea.addEventListener('input', controls);
    textarea.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      textarea.form?.requestSubmit();
    });
  }
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-build-example]')) {
    button.addEventListener('click', () => {
      if (prompt.value.trim() && !window.confirm('Replace your current idea with this example?')) return;
      prompt.value = buildExamples[button.dataset.buildExample!] ?? '';
      controls();
      prompt.focus();
    });
  }
  for (const tab of [previewTab, briefTab]) {
    tab.addEventListener('click', () => setPreviewTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setPreviewTab(event.key === 'Home' ? previewTab : event.key === 'End' ? briefTab : tab === previewTab ? briefTab : previewTab, true);
    });
  }
  node<HTMLButtonElement>('#build-export').addEventListener('click', () => {
    if (!selected) return;
    const pending = update.value.trim();
    const text = formatBuildBrief({ ...selected, name: name.value.trim() || selected.name }) + (pending ? `\nUnsaved addition\n${pending}\n` : '');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'}-brief.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Brief exported';
  });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (disposed || !(prompt.value.trim() || update.value.trim() || (selected && name.value.trim() !== selected.name))) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  return {
    load(id: string) {
      if (disposed || userId === id) return;
      userId = id;
      try {
        const nextStore = createBuildDraftStore(window.localStorage, id);
        drafts = nextStore.read();
        store = nextStore;
        renderList();
      } catch {
        store = null;
        reportError('Could not load drafts from this browser. Check that browser storage is available, then reload to try again.');
        controls();
      }
    },
    dispose() {
      disposed = true;
      store = null;
      drafts = [];
      selected = null;
      prompt.value = '';
      update.value = '';
      name.value = '';
      messages.replaceChildren();
      list.replaceChildren();
      node<HTMLElement>('#build-brief-content').replaceChildren();
      window.removeEventListener('beforeunload', beforeUnload);
      controls();
    },
  };
}
