import './linux.ts';
import { API_ORIGIN, createAuthClient } from './auth.ts';
import { createProjectHosting, createProjectHostingClient, safeEndpointUrl } from './project-hosting.ts';

interface Project { id: string; name: string; domain?: string | null; created_at: string; build_app_id?: string | null; git_version_id?: string | null; github_repo?: string | null; github_branch?: string | null; github_commit_id?: string | null; github_storage?: 'retained' | 'deleting' | 'github' | null }

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
const git = document.querySelector<HTMLInputElement>('#project-git')!;
const gitOption = document.querySelector<HTMLElement>('#project-git-option')!;
const gitNote = document.querySelector<HTMLElement>('#project-git-note')!;
const create = document.querySelector<HTMLButtonElement>('#project-create')!;
const cancel = document.querySelector<HTMLButtonElement>('#project-cancel')!;
const formError = document.querySelector<HTMLElement>('#project-error')!;
const formStatus = document.querySelector<HTMLElement>('#project-status')!;
const dialogTitle = document.querySelector<HTMLElement>('#project-dialog-title')!;
const githubDialog = document.querySelector<HTMLDialogElement>('#github-dialog')!;
const githubForm = document.querySelector<HTMLFormElement>('#github-form')!;
const githubRepo = document.querySelector<HTMLSelectElement>('#github-repo')!;
const githubBranch = document.querySelector<HTMLInputElement>('#github-branch')!;
const githubSubmit = document.querySelector<HTMLButtonElement>('#github-submit')!;
const githubCancel = document.querySelector<HTMLButtonElement>('#github-cancel')!;
const githubError = document.querySelector<HTMLElement>('#github-error')!;
const githubStatus = document.querySelector<HTMLElement>('#github-status')!;
const githubTitle = document.querySelector<HTMLElement>('#github-dialog-title')!;
const githubNote = document.querySelector<HTMLElement>('#github-note')!;
const githubPicker = document.querySelector<HTMLElement>('#github-picker')!;
const githubInstallNote = document.querySelector<HTMLElement>('#github-install-note')!;
const githubManage = document.querySelector<HTMLButtonElement>('#github-manage')!;
const githubMore = document.querySelector<HTMLButtonElement>('#github-more')!;
const storageDialog = document.querySelector<HTMLDialogElement>('#project-storage-dialog')!;
const storageName = document.querySelector<HTMLElement>('#project-storage-name')!;
const storageGithub = document.querySelector<HTMLAnchorElement>('#project-storage-github')!;
const storageDelete = document.querySelector<HTMLButtonElement>('#project-storage-delete')!;
const storageCancel = document.querySelector<HTMLButtonElement>('#project-storage-cancel')!;
const storageError = document.querySelector<HTMLElement>('#project-storage-error')!;
const storageStatus = document.querySelector<HTMLElement>('#project-storage-status')!;
const abort = new AbortController();
const previewClient = createProjectHostingClient({ onUnauthenticated: () => goToLogin(), signal: abort.signal });
const hosting = createProjectHosting({ onUnauthenticated: () => goToLogin(), onClose: id => { refreshPreview(id); restoreProjectFocus(id); } });
let projects: Project[] = [];
let manageButtons = new Map<string, HTMLButtonElement>();
let openActions: { toggle: HTMLButtonElement; panel: HTMLElement; wrapper: HTMLElement } | null = null;
let editButtons = new Map<string, HTMLButtonElement>();
let endpointButtons = new Map<string, HTMLButtonElement>();
let gitButtons = new Map<string, HTMLButtonElement>();
let previewCells = new Map<string, HTMLElement>();
type PreviewState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; url: string | null; configured: boolean; available: boolean };
const previews = new Map<string, PreviewState>();
const previewEpoch = new Map<string, number>();
let editingProject: Project | null = null;
let busy = false;
let authenticated = false;
let disposed = false;
let refreshOnClose = false;
let githubProject: Project | null = null;
let githubReauthorize = false;
let githubAuthorized = false;
let githubLoading = false;
let githubGeneration = 0;
let githubCursor: string | null = null;
interface GithubRepository { id: number; fullName: string; defaultBranch: string; private: boolean }
let githubRepositories: GithubRepository[] = [];
let githubActions = new Map<string, HTMLButtonElement>();
let storageActions = new Map<string, HTMLButtonElement>();
let deletingStorageProject: Project | null = null;
let storageRefresh: ReturnType<typeof setTimeout> | undefined;
const builderURL = (id: string) => `/build/?${new URLSearchParams({ app: id })}`;

function goToLogin() {
  disposed = true;
  closeActions();
  abort.abort();
  hosting.dispose();
  dialog.close();
  githubDialog.close();
  storageDialog.close();
  clearTimeout(storageRefresh);
  list.replaceChildren();
  controls();
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function controls() {
  main.setAttribute('aria-busy', String(busy));
  newProject.disabled = busy || disposed || !authenticated;
  retry.disabled = busy || disposed;
  name.disabled = domain.disabled = git.disabled = create.disabled = cancel.disabled = busy || disposed;
  for (const button of manageButtons.values()) button.disabled = busy || disposed;
  for (const button of editButtons.values()) button.disabled = busy || disposed;
  for (const button of endpointButtons.values()) button.disabled = busy || disposed;
  for (const button of gitButtons.values()) button.disabled = busy || disposed;
  for (const button of githubActions.values()) button.disabled = busy || disposed;
  for (const [id, button] of storageActions) {
    const project = projects.find(project => project.id === id);
    button.disabled = busy || disposed || !project?.github_commit_id || project.github_storage === 'deleting';
  }
  storageDelete.disabled = storageCancel.disabled = busy || disposed;
  storageDialog.setAttribute('aria-busy', String(busy));
  githubRepo.disabled = githubBranch.disabled = busy || disposed || githubLoading || !githubAuthorized;
  githubSubmit.disabled = busy || disposed || githubLoading || githubAuthorized && !githubRepo.value;
  githubCancel.disabled = busy && !githubLoading || disposed;
  githubManage.disabled = githubMore.disabled = busy || disposed || githubLoading;
  form.setAttribute('aria-busy', String(busy));
  githubForm.setAttribute('aria-busy', String(busy || githubLoading));
}

function renderPreview(projectId: string) {
  const cell = previewCells.get(projectId);
  if (!cell) return;
  cell.replaceChildren();
  cell.removeAttribute('data-unset');
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
    if (!preview.configured) cell.setAttribute('data-unset', 'true');
    return;
  }
  if (preview.available) {
    const link = document.createElement('a');
    link.href = preview.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open preview';
    link.title = preview.url;
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

function restoreProjectFocus(id?: string) {
  if (!disposed && id) manageButtons.get(id)?.focus();
}

function closeActions(restoreFocus = false) {
  if (!openActions) return;
  const { toggle, panel } = openActions;
  openActions = null;
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) toggle.focus();
}

function positionActions() {
  if (!openActions) return;
  const { toggle, panel } = openActions;
  const bounds = toggle.getBoundingClientRect();
  const gap = 8;
  const viewportHeight = window.innerHeight;
  panel.style.maxHeight = `${viewportHeight - gap * 2}px`;
  panel.style.left = `${Math.max(gap, Math.min(bounds.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - gap))}px`;
  const below = bounds.bottom + 4;
  const top = below + panel.offsetHeight <= viewportHeight - gap ? below : bounds.top - panel.offsetHeight - 4;
  panel.style.top = `${Math.max(gap, Math.min(top, viewportHeight - panel.offsetHeight - gap))}px`;
}

// A disclosure with native links and buttons keeps Tab navigation familiar.
document.addEventListener('click', event => {
  if (openActions && !openActions.wrapper.contains(event.target as Node)) closeActions();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && openActions) { event.preventDefault(); closeActions(true); }
});
window.addEventListener('resize', positionActions);
window.addEventListener('scroll', event => {
  if (openActions && !openActions.panel.contains(event.target as Node)) closeActions(true);
}, true);

function render() {
  const focusedProjectId = [...manageButtons].find(([, button]) => button === document.activeElement)?.[0];
  closeActions();
  list.replaceChildren();
  manageButtons = new Map();
  editButtons = new Map();
  endpointButtons = new Map();
  gitButtons = new Map();
  githubActions = new Map();
  storageActions = new Map();
  previewCells = new Map();
  for (const project of projects) {
    const hasCode = Boolean(project.build_app_id || project.git_version_id || project.github_repo);
    const row = document.createElement('tr');
    row.className = 'project-table-row';
    const title = document.createElement('td');
    title.className = 'project-name';
    if (project.build_app_id) {
      const link = document.createElement('a');
      link.href = builderURL(project.build_app_id);
      link.textContent = project.name;
      link.setAttribute('aria-label', `Open ${project.name} in Builder`);
      title.append(link);
    } else title.textContent = project.name;
    const projectDomain = document.createElement('td');
    projectDomain.className = 'project-domain';
    projectDomain.textContent = project.domain || '—';
    if (!project.domain) projectDomain.setAttribute('data-empty', 'true');
    const previewCell = document.createElement('td');
    previewCell.className = 'project-preview';
    previewCells.set(project.id, previewCell);
    const sourceCell = document.createElement('td');
    sourceCell.className = 'project-source';
    if (project.github_repo) {
      const repo = document.createElement('a');
      repo.className = 'project-repository';
      repo.href = `https://github.com/${encodeURIComponent(project.github_repo.split('/')[0])}/${encodeURIComponent(project.github_repo.split('/')[1] ?? '')}`;
      repo.target = '_blank';
      repo.rel = 'noopener';
      repo.title = project.github_repo;
      repo.setAttribute('aria-label', `Open ${project.github_repo} on GitHub, branch ${project.github_branch || 'main'}`);
      const repoName = document.createElement('span');
      repoName.className = 'project-repository-name';
      repoName.textContent = project.github_repo;
      const branch = document.createElement('span');
      branch.className = 'project-source-note';
      branch.textContent = `GitHub · ${project.github_branch || 'main'}`;
      repo.append(repoName, branch);
      sourceCell.append(repo);
      if (project.github_storage === 'deleting') {
        const pending = document.createElement('span');
        pending.className = 'project-source-note';
        pending.textContent = 'Storage cleanup pending';
        sourceCell.append(pending);
      }
    } else {
      sourceCell.textContent = hasCode ? 'Mainbrella Git' : 'Git not enabled';
      if (!hasCode) sourceCell.classList.add('project-source-empty');
    }

    const actions = document.createElement('div');
    actions.className = 'container-actions';
    if (hasCode) {
      const code = document.createElement('a');
      code.className = 'project-code-link';
      if (project.github_repo) {
        const branchPath = (project.github_branch || 'main').split('/').map(encodeURIComponent).join('/');
        code.href = `https://github.com/${encodeURIComponent(project.github_repo.split('/')[0])}/${encodeURIComponent(project.github_repo.split('/')[1] ?? '')}/tree/${branchPath}`;
        code.target = '_blank';
        code.rel = 'noopener';
      } else {
        code.href = `/projects/code/?${new URLSearchParams({ project: project.id })}`;
      }
      code.textContent = 'Code';
      code.setAttribute('aria-label', `Browse source code for ${project.name}`);
      actions.append(code);
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'project-action-menu';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dashboard-retry project-manage';
    toggle.textContent = 'Manage';
    const chevron = document.createElement('span');
    chevron.textContent = '⌄';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(chevron);
    toggle.setAttribute('aria-label', `Manage ${project.name}`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `project-actions-${project.id}`);
    manageButtons.set(project.id, toggle);
    const panel = document.createElement('div');
    panel.id = `project-actions-${project.id}`;
    panel.className = 'project-menu-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Actions for ${project.name}`);
    toggle.addEventListener('click', () => {
      if (busy || disposed) return;
      if (openActions?.toggle === toggle) { closeActions(); return; }
      closeActions();
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      openActions = { toggle, panel, wrapper };
      positionActions();
    });
    toggle.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && !toggle.disabled) {
        event.preventDefault();
        if (openActions?.toggle !== toggle) toggle.click();
        panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      }
    });
    panel.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.findIndex(item => item === document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault();
      items[next]?.focus();
    });
    wrapper.addEventListener('focusout', event => {
      if (openActions?.toggle === toggle && !wrapper.contains(event.relatedTarget as Node | null)) closeActions();
    });
    function menuButton(label: string, action?: () => unknown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-menu-action';
      button.textContent = label;
      button.addEventListener('click', () => {
        if (busy || disposed || button.disabled) return;
        // Return focus to the visible trigger before opening a dialog.
        closeActions(true);
        return action?.();
      });
      return button;
    }
    const edit = menuButton('Edit details', () => openProjectDialog(project));
    editButtons.set(project.id, edit);
    const endpoint = menuButton('Endpoint', () => hosting.open(project));
    const customDomains = menuButton('Custom domains', () => hosting.open(project, 'domains'));
    const buyDomain = menuButton('Buy domain');
    buyDomain.dataset.domainBuy = '';
    buyDomain.dataset.projectId = project.id;
    buyDomain.dataset.projectName = project.name;
    endpointButtons.set(project.id, endpoint);
    endpointButtons.set(`${project.id}:domains`, customDomains);
    endpointButtons.set(`${project.id}:buy`, buyDomain);
    panel.append(edit, endpoint, customDomains, buyDomain);
    const sourceHeading = document.createElement('p');
    sourceHeading.className = 'project-menu-heading';
    sourceHeading.textContent = 'Source';
    panel.append(sourceHeading);
    if (project.github_repo) {
      const state = document.createElement('p');
      state.className = 'project-menu-detail';
      const commit = project.github_commit_id ? ` · ${project.github_commit_id.slice(0, 7)}` : '';
      state.textContent = `${project.github_branch || 'main'}${commit}`;
      const reconnect = menuButton('Reconnect GitHub access', () => openGitHubDialog(project, true));
      githubActions.set(project.id, reconnect);
      panel.append(state, reconnect);
      const stored = document.createElement('p');
      stored.className = 'project-storage-state';
      stored.textContent = project.github_storage === 'github' ? 'Mainbrella copy · deleted'
        : project.github_storage === 'deleting' ? 'Mainbrella copy · deleting…'
        : 'Mainbrella copy · stored';
      const storageNote = document.createElement('p');
      storageNote.className = 'project-storage-note';
      storageNote.textContent = project.github_storage === 'github' ? 'Builder reads from GitHub. Future builds may store new files.'
        : project.github_storage === 'deleting' ? 'Storage charges stop once cleanup finishes.'
        : 'Stored files still incur Mainbrella storage charges.';
      panel.append(stored, storageNote);
      if (project.github_storage !== 'github') {
        const remove = menuButton(project.github_storage === 'deleting' ? 'Deleting copy…' : 'Delete Mainbrella copy', () => openStorageDialog(project));
        remove.classList.add('button-danger');
        if (!project.github_commit_id) {
          const note = document.createElement('p');
          note.className = 'project-storage-note';
          note.textContent = 'Push code to GitHub before deleting this copy.';
          panel.append(note);
          remove.title = note.textContent;
        }
        storageActions.set(project.id, remove);
        panel.append(remove);
      }
    } else {
      if (!hasCode) {
        const enableGit = menuButton('Enable Git history', () => {
          openProjectDialog(project); git.checked = true; git.focus();
        });
        gitButtons.set(project.id, enableGit);
        panel.append(enableGit);
      }
      const connect = menuButton('Connect GitHub', () => openGitHubDialog(project));
      githubActions.set(project.id, connect);
      panel.append(connect);
    }
    wrapper.append(toggle, panel);
    actions.append(wrapper);
    const actionCell = document.createElement('td');
    actionCell.className = 'project-actions';
    actionCell.append(actions);
    row.append(title, projectDomain, previewCell, sourceCell, actionCell);
    list.append(row);
    if (!previews.has(project.id)) refreshPreview(project.id);
    else renderPreview(project.id);
  }
  restoreProjectFocus(focusedProjectId);
  status.textContent = projects.length ? '' : "You haven't created any projects.";
  clearTimeout(storageRefresh);
  if (projects.some(project => project.github_storage === 'deleting')) scheduleStorageRefresh();
}

function scheduleStorageRefresh() {
  storageRefresh = setTimeout(() => {
    if (disposed) return;
    // Keep menus and in-progress edits stable during background cleanup.
    if (busy || openActions || dialog.open || githubDialog.open || storageDialog.open) scheduleStorageRefresh();
    else void load();
  }, 5000);
}

function openStorageDialog(project: Project) {
  if (busy || disposed || !authenticated || !project.github_commit_id || project.github_storage === 'deleting') return;
  deletingStorageProject = project;
  storageName.textContent = project.name;
  storageGithub.href = `https://github.com/${project.github_repo}/tree/${encodeURIComponent(project.github_branch ?? 'main')}`;
  storageGithub.textContent = `${project.github_repo} · ${project.github_branch ?? 'main'}`;
  storageError.textContent = storageStatus.textContent = '';
  storageError.hidden = true;
  storageDialog.showModal();
  storageCancel.focus();
}

storageCancel.addEventListener('click', () => storageDialog.close());
storageDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
storageDialog.addEventListener('close', () => {
  const id = deletingStorageProject?.id;
  deletingStorageProject = null;
  restoreProjectFocus(id);
});
storageDelete.addEventListener('click', async () => {
  const project = deletingStorageProject;
  if (busy || disposed || !project) return;
  busy = true;
  controls();
  storageError.hidden = true;
  storageStatus.textContent = 'Checking GitHub and deleting stored files…';
  try {
    const result = await githubRequest(`/projects/github/storage?id=${encodeURIComponent(project.id)}`, 'DELETE', undefined, 120_000);
    if (disposed) return;
    if (!['github', 'deleting'].includes(result.storage)) throw new Error('invalid_response');
    const index = projects.findIndex(item => item.id === project.id);
    if (index < 0) throw new Error('project_missing');
    projects[index] = { ...projects[index], github_storage: result.storage, github_commit_id: result.github?.commitId ?? project.github_commit_id };
    storageDialog.close();
    render();
    status.textContent = result.storage === 'deleting'
      ? 'Storage cleanup is pending and will retry automatically. Your project and GitHub repository remain available.'
      : 'Mainbrella copy deleted. Your project stays in Builder and reads its saved code from GitHub.';
  } catch (cause) {
    if (disposed) return;
    const code = cause instanceof Error ? cause.message : '';
    storageError.textContent = code === 'github_source_not_pushed'
      ? 'Your current code or images are not fully pushed to GitHub. Save a version in Builder, then try again. Your Mainbrella copy was kept.'
      : code === 'github_project_busy' ? 'Wait for the current build or project change to finish, then try again.'
      : code.startsWith('github_') ? githubErrorMessage(code)
      : 'Could not confirm storage deletion. Close this dialog and refresh Projects to check its status before retrying.';
    storageError.hidden = false;
  } finally {
    busy = false;
    storageStatus.textContent = '';
    controls();
    if (!storageDialog.open) restoreProjectFocus(project.id);
  }
});

async function openGitHubDialog(project: Project, reauthorize = false, repo = '', branch = 'main') {
  if (disposed || !authenticated) return;
  githubProject = project;
  githubReauthorize = reauthorize;
  const generation = ++githubGeneration;
  githubLoading = false;
  githubRepositories = [];
  githubCursor = null;
  githubForm.reset();
  githubRepo.replaceChildren();
  githubBranch.value = branch;
  githubPicker.hidden = true;
  githubInstallNote.hidden = false;
  githubManage.hidden = githubMore.hidden = true;
  githubNote.hidden = false;
  githubError.hidden = true;
  githubError.textContent = '';
  githubStatus.textContent = '';
  githubAuthorized = false;
  githubSubmit.textContent = 'Install GitHub app';
  githubTitle.textContent = project.github_repo ? 'Reconnect GitHub access' : 'Connect GitHub';
  githubDialog.showModal();
  controls();
  githubSubmit.focus();
  if (!reauthorize) await loadGithubRepositories(generation, repo, branch);
}

async function loadGithubRepositories(generation = githubGeneration, preferredRepo = githubRepo.value, preferredBranch = githubBranch.value) {
  githubLoading = true;
  githubError.hidden = true;
  githubStatus.textContent = 'Loading repositories…';
  controls();
  try {
    const data = await githubRequest(`/github/build/repositories${githubCursor ? `?${new URLSearchParams({ cursor: githubCursor })}` : ''}`, 'GET');
    if (disposed || generation !== githubGeneration) return;
    if (!Array.isArray(data.repositories) || data.nextCursor !== null && typeof data.nextCursor !== 'string'
      || data.repositories.some((repo: GithubRepository) => typeof repo.fullName !== 'string' || typeof repo.defaultBranch !== 'string')) throw new Error('github_unavailable');
    githubRepositories = [...new Map([...githubRepositories, ...data.repositories].map((repo: GithubRepository) => [repo.fullName, repo])).values()]
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    githubCursor = data.nextCursor;
    githubAuthorized = true;
    githubPicker.hidden = false;
    githubInstallNote.hidden = true;
    githubManage.hidden = false;
    githubMore.hidden = !githubCursor;
    githubSubmit.textContent = 'Link repository';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = githubRepositories.length ? 'Choose a repository' : 'No writable repositories available';
    githubRepo.replaceChildren(placeholder);
    for (const repo of githubRepositories) {
      const option = document.createElement('option');
      option.value = repo.fullName;
      option.textContent = `${repo.fullName}${repo.private ? ' (private)' : ''}`;
      githubRepo.append(option);
    }
    const selected = githubRepositories.find(repo => repo.fullName === preferredRepo)
      ?? (githubRepositories.length === 1 ? githubRepositories[0] : null);
    githubRepo.value = selected?.fullName ?? '';
    githubBranch.value = selected?.fullName === preferredRepo ? preferredBranch : selected?.defaultBranch ?? 'main';
    githubStatus.textContent = githubRepositories.length ? '' : githubCursor
      ? 'No writable repositories on this page. Load more repositories to continue.'
      : 'No writable repositories are available. Update repository access in GitHub, then return here.';
  } catch (cause) {
    if (disposed || generation !== githubGeneration) return;
    const code = cause instanceof Error ? cause.message : 'github_unavailable';
    githubStatus.textContent = '';
    if (code === 'github_connection_required') {
      githubAuthorized = false;
      githubPicker.hidden = true;
      githubInstallNote.hidden = false;
      githubManage.hidden = githubMore.hidden = true;
      githubReauthorize = true;
      githubSubmit.textContent = 'Install GitHub app';
    } else {
      githubError.textContent = githubErrorMessage(code);
      githubError.hidden = false;
    }
  } finally {
    if (generation === githubGeneration) {
      githubLoading = false;
      controls();
      if (githubDialog.open && !busy) (githubAuthorized ? githubRepo : githubSubmit).focus();
    }
  }
}

function githubErrorMessage(code: string) {
  const messages: Record<string, string> = {
    github_build_unavailable: 'GitHub linking is temporarily unavailable. Try again shortly.',
    github_connection_required: 'Authorize GitHub to continue.',
    github_connection_busy: 'GitHub access is refreshing. Try again shortly.',
    github_repository_access_required: 'Grant access to this repository in GitHub, then try again.',
    github_write_access_required: 'This GitHub connection needs write access to the repository.',
    github_branch_conflict: 'That branch contains unrelated history. Choose an empty branch or the branch at this project’s saved head.',
    github_branch_protected: 'GitHub protects this branch from updates. Choose another branch or change its protection rules.',
    github_project_busy: 'This project is busy. Wait for its current operation to finish, then try again.',
    github_source_limit: 'This repository exceeds Builder source limits. Reduce its size in GitHub before linking.',
    build_git_file_limit: 'A repository file exceeds the 25 MiB limit. Reduce its size before linking.',
    build_app_limit: 'You have reached the 50-app limit. Delete an app before linking this project.',
    github_rate_limited: 'GitHub is limiting requests right now. Try again shortly.',
    github_unavailable: 'GitHub is temporarily unavailable. Try again shortly.',
    invalid_request: 'Enter a valid GitHub repository and branch.',
  };
  return messages[code] ?? 'Could not connect this repository. Check the details and try again.';
}

async function request(fields?: { name: string; domain: string | null; git?: boolean }, id?: string) {
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
  if (!response.ok || !data) throw new Error(data?.error === 'build_app_limit' ? 'build_app_limit' : 'projects_unavailable');
  return data;
}

async function githubRequest(path: string, method: string, body?: unknown, timeoutMs = 15_000) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method, credentials: 'include', redirect: 'error',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) { goToLogin(); throw new Error('not_authenticated'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(typeof data?.error === 'string' ? data.error : 'github_build_unavailable');
  return data;
}

async function handleGitHubReturn() {
  const params = new URLSearchParams(location.search);
  const projectId = params.get('githubProject');
  const result = params.get('github');
  if (!projectId || !result) return;
  const project = projects.find(item => item.id === projectId);
  if (!project) return;
  const repo = params.get('githubRepo') ?? project.github_repo ?? '';
  const branch = params.get('githubBranch') ?? project.github_branch ?? 'main';
  for (const key of ['githubProject', 'github', 'githubRepo', 'githubBranch']) params.delete(key);
  window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  if (result === 'connected') {
    if (project.github_repo) {
      try {
        await githubRequest(`/projects/github?id=${encodeURIComponent(project.id)}`, 'PUT', { repo: project.github_repo, branch: project.github_branch ?? 'main' });
        if (!disposed) status.textContent = 'GitHub access updated.';
      } catch (cause) {
        if (disposed) return;
        await openGitHubDialog(project, true);
        githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_unavailable');
        githubError.hidden = false;
      }
    } else {
      await openGitHubDialog(project, false, repo, branch);
    }
  } else {
    status.textContent = result === 'approval_pending'
      ? 'GitHub approval is pending. Complete the approval, then reconnect GitHub.'
      : result === 'cancelled' ? 'GitHub authorization was cancelled.' : githubErrorMessage(result);
    if (!project.github_repo) {
      const message = status.textContent;
      await openGitHubDialog(project, true, repo, branch);
      githubError.textContent = message;
      githubError.hidden = false;
    }
  }
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
    await handleGitHubReturn();
  } catch {
    if (disposed) return;
    status.textContent = '';
    error.textContent = 'Could not load your projects. Check your connection and try again.';
    error.hidden = retry.hidden = false;
  } finally {
    busy = false;
    controls();
    if (githubDialog.open && !githubLoading) (githubAuthorized ? githubRepo : githubSubmit).focus();
  }
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
  git.checked = false;
  gitOption.hidden = Boolean(editingProject?.build_app_id || editingProject?.git_version_id || editingProject?.github_repo);
  gitNote.textContent = editingProject?.github_repo ? editingProject.github_storage === 'github'
    ? 'This project reads saved code from GitHub. Its Mainbrella copy has been deleted.'
    : editingProject.github_storage === 'deleting' ? 'This project uses GitHub. Mainbrella storage cleanup is pending.'
    : 'Commits go to GitHub. A Mainbrella working copy is also stored and incurs storage charges until you delete it.'
    : (editingProject?.build_app_id || editingProject?.git_version_id) ? 'Git history is enabled. Your saved versions are preserved.'
    : 'Save versions as you build. Enabling Git does not start a build.';
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
  const fields = { name: name.value.trim(), domain: domain.value.trim() || null, ...(!(editingProject?.build_app_id || editingProject?.git_version_id || editingProject?.github_repo) && git.checked ? { git: true } : {}) };
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
  } catch (cause) {
    if (disposed) return;
    refreshOnClose = !editing;
    formError.textContent = cause instanceof Error && cause.message === 'build_app_limit'
      ? 'You have reached the 50-workspace limit. Create this project without Git, or free a workspace in Builder.' : editing
      ? 'Could not save your changes. Check your connection and try again.'
      : 'Could not confirm project creation. Close this dialog and refresh the list before trying again.';
    formError.hidden = false;
  } finally {
    busy = false;
    formStatus.textContent = '';
    controls();
    restoreProjectFocus(restoreFocusId ?? undefined);
  }
});

retry.addEventListener('click', load);
dialog.addEventListener('close', () => {
  const id = editingProject?.id;
  resetProjectDialog();
  if (id) restoreProjectFocus(id); else if (!disposed) newProject.focus();
  if (refreshOnClose && !disposed) { refreshOnClose = false; load(); }
});
githubCancel.addEventListener('click', () => githubDialog.close());
githubDialog.addEventListener('cancel', event => { if (busy && !githubLoading) event.preventDefault(); });
githubDialog.addEventListener('close', () => { githubGeneration++; githubLoading = false; controls(); restoreProjectFocus(githubProject?.id); });
githubRepo.addEventListener('change', () => {
  githubBranch.value = githubRepositories.find(repo => repo.fullName === githubRepo.value)?.defaultBranch ?? 'main';
  controls();
});
githubMore.addEventListener('click', () => loadGithubRepositories());
async function installGithubApp() {
  if (busy || disposed || !githubProject) return;
  busy = true;
  controls();
  githubError.hidden = true;
  githubStatus.textContent = 'Opening GitHub…';
  try {
    const returnTo = `/projects/?${new URLSearchParams({ githubProject: githubProject.id })}`;
    const result = await githubRequest('/github/build/connect', 'POST', {
      projectId: githubProject.id, returnTo, ...(githubReauthorize ? { reauthorize: true } : {}),
    });
    if (disposed) return;
    const target = typeof result.url === 'string' ? new URL(result.url) : null;
    if (!target || target.protocol !== 'https:' || target.origin !== 'https://github.com') throw new Error('github_build_unavailable');
    window.location.replace(target.href);
  } catch (cause) {
    if (disposed) return;
    githubStatus.textContent = '';
    githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_unavailable');
    githubError.hidden = false;
  } finally { busy = false; controls(); }
}
githubManage.addEventListener('click', installGithubApp);
githubForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || githubLoading || !githubProject) return;
  if (!githubAuthorized) { await installGithubApp(); return; }
  if (!githubForm.reportValidity()) return;
  const repo = githubRepositories.find(repo => repo.fullName === githubRepo.value)?.fullName;
  const branch = githubBranch.value.trim();
  if (!repo || !branch || branch.length > 255 || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')) {
    githubError.textContent = 'Enter a valid GitHub repository and branch.';
    githubError.hidden = false;
    return;
  }
  busy = true;
  controls();
  githubError.hidden = true;
  try {
    githubStatus.textContent = 'Linking repository… This can take up to two minutes.';
    const result = await githubRequest(`/projects/github?id=${encodeURIComponent(githubProject.id)}`, 'PUT', { repo, branch }, 120_000);
    if (disposed) return;
    const index = projects.findIndex(item => item.id === githubProject?.id);
    if (index < 0) throw new Error('project_missing');
    projects[index] = { ...projects[index], git_version_id: null, github_repo: result.github?.repo ?? repo, github_branch: result.github?.branch ?? branch, github_commit_id: result.github?.commitId ?? null, github_storage: projects[index].github_storage ?? 'retained' };
    githubDialog.close();
    render();
    status.textContent = 'GitHub connected. Your Mainbrella working copy is still stored and billed; you can delete it after pushing.';
    try {
      const refreshed = await request();
      if (Array.isArray(refreshed.projects) && !disposed) { projects = refreshed.projects; render(); status.textContent = 'GitHub connected. Your Mainbrella working copy is still stored and billed; you can delete it after pushing.'; }
    } catch { /* Keep the successful link shown while the project list refreshes later. */ }
  } catch (cause) {
    if (disposed) return;
    if (githubAuthorized && cause instanceof Error && cause.message === 'github_connection_required') {
      githubAuthorized = false;
      githubReauthorize = true;
      githubSubmit.textContent = 'Install GitHub app';
      githubStatus.textContent = 'GitHub access expired. Reconnect to finish linking this repository.';
    }
    githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_build_unavailable');
    githubError.hidden = false;
  } finally {
    busy = false;
    controls();
    if (!githubDialog.open) restoreProjectFocus(githubProject?.id);
  }
});
window.addEventListener('auth-change', event => { if (event.detail?.user === null) goToLogin(); });
window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; abort.abort(); hosting.dispose(); clearTimeout(storageRefresh); } });
load();
