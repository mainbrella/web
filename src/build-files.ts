import type { BuildFileInfo } from './build-api.ts';

export type BuildFileEntry = { name: string; path: string; directory: boolean };
export function buildFileEntries(paths: string[], directory = ''): BuildFileEntry[] {
  const prefix = directory ? `${directory}/` : '', entries = new Map<string, BuildFileEntry>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length), name = relative.split('/')[0];
    if (!name) continue;
    const folder = relative.includes('/'), current = entries.get(name);
    if (!current || folder) entries.set(name, { name, path: `${prefix}${name}`, directory: folder });
  }
  return [...entries.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function createBuildFileBrowser(host: HTMLElement) {
  const breadcrumbs = document.createElement('nav'), content = document.createElement('div');
  breadcrumbs.className = 'build-file-breadcrumbs'; breadcrumbs.setAttribute('aria-label', 'Repository path');
  content.className = 'build-file-content'; host.append(breadcrumbs, content);
  let files: BuildFileInfo[] = [], current = '', generation = 0;
  let readFile: (path: string) => Promise<string>, fileURL: (path: string) => string;
  let imageCleanup: (() => void) | undefined;

  function button(label: string, path: string) {
    const result = document.createElement('button'); result.type = 'button'; result.textContent = label;
    result.addEventListener('click', () => { current = path; render(); breadcrumbs.querySelector<HTMLElement>('[aria-current]')?.focus(); });
    return result;
  }
  function render() {
    const request = ++generation;
    imageCleanup?.(); imageCleanup = undefined;
    breadcrumbs.replaceChildren(); content.replaceChildren();
    const root = button('Files', ''); breadcrumbs.append(root);
    if (!current) root.setAttribute('aria-current', 'location');
    let path = '';
    for (const segment of current.split('/').filter(Boolean)) {
      path = path ? `${path}/${segment}` : segment;
      const separator = document.createElement('span'); separator.textContent = '/'; separator.setAttribute('aria-hidden', 'true');
      const link = button(segment, path);
      if (path === current) link.setAttribute('aria-current', 'location');
      breadcrumbs.append(separator, link);
    }
    const file = files.find(file => file.path === current);
    if (file) {
      const toolbar = document.createElement('div'), back = button('Back to files', current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '');
      toolbar.className = 'build-file-toolbar'; toolbar.append(back);
      content.append(toolbar);
      if (file.type === 'image') {
        const figure = document.createElement('figure'), image = document.createElement('img'), state = document.createElement('p');
        figure.className = 'build-file-image'; image.alt = current; image.hidden = true;
        state.className = 'build-file-status'; state.textContent = 'Loading image…'; state.setAttribute('role', 'status');
        image.onload = () => { image.hidden = false; state.hidden = true; };
        image.onerror = () => { state.textContent = 'Could not load this image.'; const retry = document.createElement('button');
          retry.type = 'button'; retry.textContent = 'Retry'; retry.addEventListener('click', render, { once: true }); state.append(' ', retry); };
        imageCleanup = () => { image.onload = null; image.onerror = null; };
        figure.append(state, image); content.append(figure); image.src = fileURL(current);
      } else {
        const state = document.createElement('p'); state.className = 'build-file-status'; state.textContent = 'Loading file…'; state.setAttribute('role', 'status'); content.append(state);
        void readFile(current).then(text => {
          if (request !== generation) return;
          const lines = text.split('\n').length, meta = document.createElement('span');
          meta.textContent = `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`; toolbar.append(meta);
          const pre = document.createElement('pre'), code = document.createElement('code');
          pre.tabIndex = 0; pre.setAttribute('aria-label', current); code.textContent = text;
          pre.append(code); state.replaceWith(pre);
        }).catch(() => {
          if (request !== generation) return;
          state.textContent = 'Could not load this file.';
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.addEventListener('click', render, { once: true }); state.append(' ', retry);
        });
      }
      return;
    }
    const entries = buildFileEntries(files.map(file => file.path), current);
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'build-file-status'; empty.textContent = 'No files yet.'; content.append(empty); return; }
    const list = document.createElement('ul'); list.className = 'build-file-list'; list.setAttribute('aria-label', current ? `Files in ${current}` : 'Repository files');
    for (const entry of entries) {
      const row = document.createElement('li'), open = button(entry.name, entry.path), icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.5'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = entry.directory ? '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/>' : '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4"/>';
      const name = document.createElement('span'); name.className = 'build-file-name'; name.textContent = entry.name;
      open.replaceChildren(icon, name); open.setAttribute('aria-label', `${entry.directory ? 'Open folder' : 'Open file'} ${entry.path}`);
      const kind = document.createElement('span'); kind.className = 'build-file-kind'; kind.textContent = entry.directory ? 'Folder' : files.find(file => file.path === entry.path)?.type === 'image' ? 'Image' : 'File';
      open.append(kind); row.append(open); list.append(row);
    }
    content.append(list);
  }
  return {
    setFiles(next: BuildFileInfo[], read: (path: string) => Promise<string>, url: (path: string) => string) {
      files = next; readFile = read; fileURL = url;
      if (current && !files.some(file => file.path === current || file.path.startsWith(`${current}/`))) current = '';
      render();
    },
    status(message: string, reset = false) {
      imageCleanup?.(); imageCleanup = undefined;
      generation++;
      if (reset) { files = []; current = ''; }
      breadcrumbs.replaceChildren(); content.replaceChildren();
      const state = document.createElement('p'); state.className = 'build-file-status'; state.textContent = message; state.setAttribute('role', 'status'); content.append(state);
    },
  };
}
