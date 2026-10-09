import { API_ORIGIN, createAuthClient } from './auth.ts';
import { createProjectHosting, createProjectHostingClient, safeEndpointUrl } from './project-hosting.ts';

interface Project { id: string; name: string; domain?: string | null; created_at: string }

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#projects-status')!;
const error = document.querySelector<HTMLElement>('#projects-error')!;
const retry = document.querySelector<HTMLButtonElement>('#projects-retry')!;
const list = document.querySelector<HTMLTableSectionElement>('#project-list')!;
const newProject = document.querySelector<HTMLButtonElement>('#project-new')!;
const dialog = document.querySelector<HTMLDialogElement>('#project-dialog')!;
const form = document.querySelector<HTMLFormElement>('#project-form')!;
const name = document.querySelector<HTMLInputElement>('#project-name')!;
const domain = document.querySelector<HTMLInputElement>('#project-domain')!;
const create = document.querySelector<HTMLButtonElement>('#project-create')!;
const cancel = document.querySelector<HTMLButtonElement>('#project-cancel')!;
const formError = document.querySelector<HTMLElement>('#project-error')!;
const formStatus = document.querySelector<HTMLElement>('#project-status')!;
const dialogTitle = document.querySelector<HTMLElement>('#project-dialog-title')!;
const abort = new AbortController();
const previewClient = createProjectHostingClient({ onUnauthenticated: () => goToLogin(), signal: abort.signal });
const hosting = createProjectHosting({ onUnauthenticated: () => goToLogin(), onClose: refreshPreview });
let projects: Project[] = [];
let editButtons = new Map<string, HTMLButtonElement>();
let endpointButtons = new Map<string, HTMLButtonElement>();
let previewCells = new Map<string, HTMLElement>();
type PreviewState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; url: string | null; configured: boolean; available: boolean };
const previews = new Map<string, PreviewState>();
const previewEpoch = new Map<string, number>();
let editingProject: Project | null = null;
let busy = false;
let authenticated = false;
let disposed = false;
let refreshOnClose = false;

function goToLogin() {
  disposed = true;
  abort.abort();
  hosting.dispose();
  dialog.close();
  list.replaceChildren();
  controls();
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function controls() {
  main.setAttribute('aria-busy', String(busy));
  newProject.disabled = busy || disposed || !authenticated;
  retry.disabled = busy || disposed;
  name.disabled = domain.disabled = create.disabled = cancel.disabled = busy || disposed;
  for (const button of editButtons.values()) button.disabled = busy || disposed;
  for (const button of endpointButtons.values()) button.disabled = busy || disposed;
  form.setAttribute('aria-busy', String(busy));
}

function renderPreview(projectId: string) {
  const cell = previewCells.get(projectId);
  if (!cell) return;
  cell.replaceChildren();
  const preview = previews.get(projectId) ?? { kind: 'loading' as const };
  if (preview.kind === 'loading') {
    cell.textContent = 'Loading…';
    return;
  }
  if (preview.kind === 'error') {
    const label = document.createElement('span');
    label.textContent = 'Could not load';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dashboard-retry';
    button.textContent = 'Retry';
    button.setAttribute('aria-label', 'Retry preview URL');
    button.addEventListener('click', () => refreshPreview(projectId));
    cell.append(label, button);
    return;
  }
  if (!preview.url) {
    cell.textContent = preview.configured ? 'Unavailable' : 'Not set';
    return;
  }
  if (preview.available) {
    const link = document.createElement('a');
    link.href = preview.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = preview.url;
    link.setAttribute('aria-label', `Open preview for ${projects.find(project => project.id === projectId)?.name ?? 'project'}`);
    cell.append(link);
  } else {
    const url = document.createElement('span');
    url.textContent = preview.url;
    const note = document.createElement('span');
    note.className = 'project-preview-note';
    note.textContent = 'Unavailable';
    cell.append(url, note);
  }
}

function refreshPreview(projectId: string) {
  if (disposed || !projects.some(project => project.id === projectId)) return;
  const epoch = (previewEpoch.get(projectId) ?? 0) + 1;
  previewEpoch.set(projectId, epoch);
  previews.set(projectId, { kind: 'loading' });
  renderPreview(projectId);
  void previewClient.endpoint(projectId).then(data => {
    if (disposed || previewEpoch.get(projectId) !== epoch) return;
    const configured = data.endpoint.target !== null && data.endpoint.backendStatus !== 'unlinked';
    const safeUrl = configured ? safeEndpointUrl(data.endpoint.url) : null;
    if (configured && !safeUrl) {
      previews.set(projectId, { kind: 'error' });
      renderPreview(projectId);
      return;
    }
    previews.set(projectId, {
      kind: 'ready',
      url: safeUrl?.href ?? null,
      configured,
      available: data.endpoint.backendStatus === 'running',
    });
    renderPreview(projectId);
  }).catch(() => {
    if (disposed || previewEpoch.get(projectId) !== epoch) return;
    previews.set(projectId, { kind: 'error' });
    renderPreview(projectId);
  });
}

function render() {
  list.replaceChildren();
  editButtons = new Map();
  endpointButtons = new Map();
  previewCells = new Map();
  for (const project of projects) {
    const row = document.createElement('tr');
    row.className = 'project-table-row';
    const title = document.createElement('td');
    title.className = 'project-name';
    title.textContent = project.name;
    const projectDomain = document.createElement('td');
    projectDomain.className = 'project-domain';
    projectDomain.textContent = project.domain || '—';
    const previewCell = document.createElement('td');
    previewCell.className = 'project-preview';
    previewCells.set(project.id, previewCell);
    const actions = document.createElement('div');
    actions.className = 'container-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'dashboard-retry';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit project ${project.name}`);
    edit.disabled = busy || disposed;
    edit.addEventListener('click', () => openProjectDialog(project));
    editButtons.set(project.id, edit);
    actions.append(edit);
    const endpoint = document.createElement('button');
    endpoint.type = 'button';
    endpoint.className = 'dashboard-retry';
    endpoint.textContent = 'Endpoint';
    endpoint.setAttribute('aria-label', `Manage endpoint for ${project.name}`);
    endpoint.disabled = busy || disposed;
    endpoint.addEventListener('click', () => hosting.open(project));
    endpointButtons.set(project.id, endpoint);
    actions.append(endpoint);
    const actionCell = document.createElement('td');
    actionCell.className = 'project-actions';
    actionCell.append(actions);
    row.append(title, projectDomain, previewCell, actionCell);
    list.append(row);
    if (!previews.has(project.id)) refreshPreview(project.id);
    else renderPreview(project.id);
  }
  status.textContent = projects.length ? '' : "You haven't created any projects.";
}

async function request(fields?: { name: string; domain: string | null }, id?: string) {
  const method = fields === undefined ? 'GET' : id === undefined ? 'POST' : 'PATCH';
  const endpoint = id === undefined ? `${API_ORIGIN}/projects` : `${API_ORIGIN}/projects?id=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, {
    method, credentials: 'include', redirect: 'error',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    headers: { accept: 'application/json', ...(fields === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(fields === undefined ? {} : { body: JSON.stringify(fields) }),
  });
  if (response.status === 401) { goToLogin(); throw new Error('not_authenticated'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error('projects_unavailable');
  return data;
}

async function load() {
  if (busy || disposed) return;
  busy = true;
  controls();
  error.hidden = retry.hidden = true;
  status.textContent = 'Loading projects…';
  try {
    const session = await auth.readSession();
    if (disposed) return;
    if (!session?.user) { goToLogin(); return; }
    authenticated = true;
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
    const data = await request();
    if (disposed) return;
    if (!Array.isArray(data.projects)) throw new Error('invalid_response');
    projects = data.projects;
    for (const id of previews.keys()) if (!projects.some(project => project.id === id)) { previews.delete(id); previewEpoch.delete(id); }
    render();
  } catch {
    if (disposed) return;
    status.textContent = '';
    error.textContent = 'Could not load your projects. Check your connection and try again.';
    error.hidden = retry.hidden = false;
  } finally { busy = false; controls(); }
}

function openProjectDialog(project?: Project) {
  if (busy || disposed || !authenticated) return;
  editingProject = project ?? null;
  form.reset();
  formError.hidden = true;
  formError.textContent = '';
  formStatus.textContent = '';
  dialogTitle.textContent = editingProject ? 'Edit project' : 'New project';
  create.textContent = editingProject ? 'Save changes' : 'Create project';
  if (editingProject) {
    name.value = editingProject.name;
    domain.value = editingProject.domain ?? '';
  }
  dialog.showModal();
  name.focus();
}

function resetProjectDialog() {
  editingProject = null;
  form.reset();
  formError.hidden = true;
  formError.textContent = '';
  formStatus.textContent = '';
  dialogTitle.textContent = 'New project';
  create.textContent = 'Create project';
}

newProject.addEventListener('click', () => openProjectDialog());
cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || !form.reportValidity()) return;
  const fields = { name: name.value.trim(), domain: domain.value.trim() || null };
  if (!fields.name) {
    formError.textContent = 'Enter a project name.';
    formError.hidden = false;
    name.focus();
    return;
  }
  busy = true;
  const editing = editingProject;
  let restoreFocusId: string | null = null;
  controls();
  formError.hidden = true;
  formStatus.textContent = editing ? 'Saving changes…' : 'Creating project…';
  try {
    const data = await request(fields, editing?.id);
    if (disposed) return;
    if (!data.project || typeof data.project.id !== 'string' || typeof data.project.name !== 'string'
      || (editing && data.project.id !== editing.id)) throw new Error('invalid_response');
    if (editing) {
      const index = projects.findIndex(project => project.id === editing.id);
      if (index < 0) throw new Error('project_missing');
      projects[index] = data.project;
    } else projects.unshift(data.project);
    render();
    dialog.close();
    restoreFocusId = data.project.id;
    status.textContent = editing ? 'Project updated.' : 'Project created.';
  } catch {
    if (disposed) return;
    refreshOnClose = !editing;
    formError.textContent = editing
      ? 'Could not save your changes. Check your connection and try again.'
      : 'Could not confirm project creation. Close this dialog and refresh the list before trying again.';
    formError.hidden = false;
  } finally {
    busy = false;
    formStatus.textContent = '';
    controls();
    if (restoreFocusId && !disposed) editButtons.get(restoreFocusId)?.focus();
  }
});

retry.addEventListener('click', load);
dialog.addEventListener('close', () => {
  resetProjectDialog();
  if (refreshOnClose && !disposed) { refreshOnClose = false; load(); }
});
window.addEventListener('auth-change', event => { if (event.detail?.user === null) goToLogin(); });
load();
