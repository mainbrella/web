import { BuildAPIError, buildErrorMessage, createBuildClient } from './build-api.ts';
import { createBuildSourceBrowser } from './build-source.ts';

interface Project { id: string; name: string; build_app_id?: string | null; git_version_id?: string | null; github_repo?: string | null; github_branch?: string | null }

export function initializeProjectCode<User extends { id: string }>({ apiOrigin, readSession, onUser }: {
  apiOrigin: string;
  readSession: () => Promise<{ user: User } | null>;
  onUser: (user: User) => void;
}) {
  const main = document.querySelector<HTMLElement>('#main')!;
  const title = document.querySelector<HTMLElement>('#code-title')!;
  const status = document.querySelector<HTMLElement>('#code-status')!;
  const error = document.querySelector<HTMLElement>('#code-error')!;
  const retry = document.querySelector<HTMLButtonElement>('#code-retry')!;
  const panel = document.querySelector<HTMLElement>('#code-source')!;
  const download = document.querySelector<HTMLButtonElement>('#code-download')!;
  const githubLink = document.querySelector<HTMLAnchorElement>('#code-github')!;
  const controller = new AbortController();
  const client = createBuildClient(apiOrigin, goToLogin, controller.signal);
  const source = createBuildSourceBrowser(panel, client, reportError);
  let disposed = false, loading = false, downloading = false, generation = 0;
  let userId: string | null = null, sourceId: string | null = null;
  let retryAction: () => Promise<void> = load;

  function goToLogin() {
    if (disposed) return;
    disposed = true; generation++; controller.abort(); source.reset();
    panel.hidden = download.hidden = githubLink.hidden = true; download.disabled = true;
    title.textContent = 'Code'; document.title = 'Code · Mainbrella';
    status.textContent = ''; error.hidden = retry.hidden = true;
    window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }

  function reportError(cause: unknown, action: () => Promise<void>) {
    if (disposed) return;
    error.textContent = cause instanceof BuildAPIError ? buildErrorMessage(cause.code)
      : 'Could not load project code. Check your connection and try again.';
    error.hidden = retry.hidden = false;
    retryAction = action;
  }

  async function load() {
    if (disposed || loading) return;
    const projectId = new URLSearchParams(location.search).get('project');
    if (!projectId) { status.textContent = 'Choose a project from Projects to browse its code.'; main.setAttribute('aria-busy', 'false'); return; }
    loading = true;
    const current = ++generation;
    main.setAttribute('aria-busy', 'true');
    error.hidden = retry.hidden = true; retry.disabled = true;
    panel.hidden = download.hidden = true; download.disabled = true;
    source.reset(); sourceId = null;
    status.textContent = 'Checking your session…';
    try {
      const session = await readSession();
      if (disposed || current !== generation) return;
      if (!session?.user) { goToLogin(); return; }
      userId = session.user.id;
      onUser(session.user);
      status.textContent = 'Loading code…';
      const response = await fetch(`${apiOrigin}/projects`, {
        credentials: 'include', redirect: 'error', headers: { accept: 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (response.status === 401) { goToLogin(); return; }
      const data = await response.json().catch(() => null);
      if (disposed || current !== generation) return;
      if (!response.ok || !Array.isArray(data?.projects)) throw new Error('projects_unavailable');
      const project: Project | undefined = data.projects.find((project: Project) => project.id === projectId);
      if (!project) { status.textContent = 'Project not found or unavailable to your account.'; return; }
      title.textContent = `${project.name} · Code`; document.title = `${project.name} · Code · Mainbrella`;
      if (project.github_repo) {
        const [owner, repository] = project.github_repo.split('/');
        if (owner && repository) {
          githubLink.href = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
          githubLink.textContent = `Open ${project.github_repo} on GitHub`;
          githubLink.hidden = false;
        }
      }
      if (!project.build_app_id && !project.git_version_id && !project.github_repo) { status.textContent = 'Git is not enabled for this project.'; return; }
      // Git-only projects use the same source storage, without opening a Builder workspace.
      const id = project.build_app_id ?? project.id;
      const versions = await client.versions(id);
      if (disposed || current !== generation) return;
      sourceId = id;
      source.setApp({ id, versionId: versions.versionId, ...(project.github_repo ? { github: {
        repo: project.github_repo, branch: project.github_branch ?? 'main', commitId: versions.versionId, url: githubLink.href,
      } } : {}) });
      source.setVersions(versions.versions);
      panel.hidden = false; status.textContent = '';
      download.hidden = !versions.versionId || Boolean(project.github_repo);
      download.disabled = !versions.versionId || Boolean(project.github_repo);
      await source.load();
    } catch (cause) {
      if (disposed || current !== generation) return;
      status.textContent = ''; reportError(cause, load);
    } finally {
      if (current === generation) { loading = false; main.setAttribute('aria-busy', 'false'); retry.disabled = false; }
    }
  }

  retry.addEventListener('click', () => {
    if (disposed) return;
    error.hidden = retry.hidden = true;
    void retryAction();
  });
  download.addEventListener('click', async () => {
    if (disposed || loading || downloading || download.disabled || !sourceId) return;
    const current = generation;
    downloading = true; download.disabled = true;
    error.hidden = retry.hidden = true; status.textContent = 'Preparing repository…';
    try {
      const blob = await client.export(sourceId, true);
      if (disposed || current !== generation) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'project.bundle'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Repository downloaded. Clone it with git clone -b main project.bundle project';
    } catch {
      if (disposed || current !== generation) return;
      status.textContent = ''; error.textContent = 'Could not download the repository. Try again shortly.'; error.hidden = false;
    } finally {
      downloading = false;
      if (!disposed && current === generation) download.disabled = false;
    }
  });
  void load();
  return { onAuthChange(user: { id: string } | null) {
    if (user === null || (userId && user && user.id !== userId)) goToLogin();
  } };
}
