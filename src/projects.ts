import { API_ORIGIN, createAuthClient } from './auth.ts';

interface Project { id: string; name: string; created_at: string }

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#projects-status')!;
const error = document.querySelector<HTMLElement>('#projects-error')!;
const retry = document.querySelector<HTMLButtonElement>('#projects-retry')!;
const list = document.querySelector<HTMLUListElement>('#project-list')!;
const newProject = document.querySelector<HTMLButtonElement>('#project-new')!;
const dialog = document.querySelector<HTMLDialogElement>('#project-dialog')!;
const form = document.querySelector<HTMLFormElement>('#project-form')!;
const name = document.querySelector<HTMLInputElement>('#project-name')!;
const create = document.querySelector<HTMLButtonElement>('#project-create')!;
const cancel = document.querySelector<HTMLButtonElement>('#project-cancel')!;
const formError = document.querySelector<HTMLElement>('#project-error')!;
const formStatus = document.querySelector<HTMLElement>('#project-status')!;
let projects: Project[] = [];
let busy = false;
let authenticated = false;
let disposed = false;
let refreshOnClose = false;
const abort = new AbortController();

function goToLogin() {
  disposed = true;
  abort.abort();
  dialog.close();
  list.replaceChildren();
  controls();
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function controls() {
  main.setAttribute('aria-busy', String(busy));
  newProject.disabled = busy || disposed || !authenticated;
  retry.disabled = busy || disposed;
  name.disabled = create.disabled = cancel.disabled = busy || disposed;
  form.setAttribute('aria-busy', String(busy));
}

function render() {
  list.replaceChildren();
  for (const project of projects) {
    const row = document.createElement('li');
    row.className = 'container-row';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = project.name;
    details.append(title);
    row.append(details);
    list.append(row);
  }
  status.textContent = projects.length ? '' : "You haven't created any projects.";
}

async function request(projectName?: string) {
  const response = await fetch(`${API_ORIGIN}/projects`, {
    method: projectName === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    headers: { accept: 'application/json', ...(projectName === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(projectName === undefined ? {} : { body: JSON.stringify({ name: projectName }) }),
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
    render();
  } catch {
    if (disposed) return;
    status.textContent = '';
    error.textContent = 'Could not load your projects. Check your connection and try again.';
    error.hidden = retry.hidden = false;
  } finally { busy = false; controls(); }
}

newProject.addEventListener('click', () => {
  form.reset();
  formError.hidden = true;
  formStatus.textContent = '';
  dialog.showModal();
  name.focus();
});
cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || !form.reportValidity()) return;
  const projectName = name.value.trim();
  if (!projectName) {
    formError.textContent = 'Enter a project name.';
    formError.hidden = false;
    name.focus();
    return;
  }
  busy = true;
  controls();
  formError.hidden = true;
  formStatus.textContent = 'Creating project…';
  try {
    const data = await request(projectName);
    if (disposed) return;
    if (!data.project || typeof data.project.id !== 'string' || typeof data.project.name !== 'string') throw new Error('invalid_response');
    projects.unshift(data.project);
    render();
    dialog.close();
    status.textContent = 'Project created.';
  } catch {
    if (disposed) return;
    refreshOnClose = true;
    formError.textContent = 'Could not confirm project creation. Close this dialog and refresh the list before trying again.';
    formError.hidden = false;
  } finally {
    busy = false;
    formStatus.textContent = '';
    controls();
  }
});

retry.addEventListener('click', load);
dialog.addEventListener('close', () => {
  if (refreshOnClose && !disposed) { refreshOnClose = false; load(); }
});
window.addEventListener('auth-change', event => { if (event.detail?.user === null) goToLogin(); });
load();
