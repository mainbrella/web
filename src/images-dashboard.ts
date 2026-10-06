import type { Image, ImageData } from './types.ts';
import { API_ORIGIN } from './auth.ts';

const activeStatuses = ['queued', 'building', 'publishing'];
const statusLabels: Record<string, string> = { queued: 'Queued', building: 'Building', publishing: 'Preparing to launch', ready: 'Ready', failed: 'Build failed' };
const messages: Record<string, string> = {
  invalid_image_source: 'Use a name and a single-stage Dockerfile starting with FROM mainbrella:base.',
  invalid_image_context: 'Choose a .tar.gz build context up to 512 KiB.',
  image_source_too_large: 'The upload is too large. Dockerfiles can be up to 16 KiB and build contexts up to 512 KiB.',
  image_build_in_progress: 'You already have a build in progress. Wait for it to finish.',
  image_build_quota_exceeded: 'You’ve used all 10 image builds this month. Your allowance resets next month (UTC).',
  image_storage_limit: 'You can save 3 images. Remove one before building another.',
  image_service_capacity: 'Custom image capacity is full. Please try again later.',
  image_builds_unavailable: 'Image builds are unavailable. Refresh to check their status before submitting again.',
};

export function createImagesDashboard({ onUnauthenticated, onImagesChanged, onSelectImage }: { onUnauthenticated: () => void; onImagesChanged: (images: Image[]) => void; onSelectImage: (id: string) => void }) {
  const form = document.querySelector<HTMLFormElement>('#image-form')!;
  const submit = document.querySelector<HTMLButtonElement>('#image-build')!;
  const refresh = document.querySelector<HTMLButtonElement>('#images-refresh')!;
  const list = document.querySelector<HTMLElement>('#image-list')!;
  const status = document.querySelector<HTMLElement>('#images-status')!;
  const error = document.querySelector<HTMLElement>('#images-error')!;
  const editor = document.querySelector<HTMLTextAreaElement>('#image-dockerfile')!;
  const file = document.querySelector<HTMLInputElement>('#image-file')!;
  const context = document.querySelector<HTMLInputElement>('#image-context')!;
  const logsPanel = document.querySelector<HTMLElement>('#image-logs')!;
  let data: ImageData | null = null;
  let busy = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let logId: string | null = null;
  let renderKey = '';

  function controls() {
    const pending = data?.images.some(image => activeStatuses.includes(image.status));
    const saved = data?.images.filter(image => image.status !== 'failed').length || 0;
    submit.disabled = busy || !data || !data.buildsEnabled || pending
      || data.usage.builds >= data.limits.maxBuildsPerMonth || saved >= data.limits.maxSavedImages;
    refresh.disabled = busy || disposed;
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(input => { input.disabled = busy || disposed; });
    list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || disposed; });
  }

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_ORIGIN}${path}`, { credentials: 'include', ...options });
    if (response.status === 401) { dispose(); onUnauthenticated(); throw new Error('not_authenticated'); }
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || 'image_builds_unavailable');
    return body;
  }

  function showError(cause: unknown) {
    error.textContent = messages[cause instanceof Error ? cause.message : ""] || 'Could not load images. Refresh to try again.';
    error.hidden = false;
  }

  async function loadLogs(image: Image) {
    logId = image.id;
    logsPanel.hidden = false;
    document.querySelector<HTMLElement>('#image-logs-title')!.textContent = `${image.name} · Build output`;
    const output = logsPanel.querySelector<HTMLElement>('pre')!;
    output.textContent = 'Loading build output…';
    try {
      const body = await request(`/images/${image.id}/logs`);
      if (disposed || logId !== image.id) return;
      output.textContent = body.logs || 'Build output will be available when the build finishes.';
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error"); if (!disposed) output.textContent = 'Could not load build output. Close and try again.'; }
  }

  function render() {
    if (!data) return;
    const key = JSON.stringify(data.images);
    const remaining = Math.max(0, data.limits.maxBuildsPerMonth - data.usage.builds);
    status.textContent = !data.buildsEnabled ? 'Custom image builds are not available yet. Choose a prebuilt image above.'
      : data.images.length ? `${remaining} image builds remaining this month.`
        : `You have no custom images. ${remaining} image builds remaining this month.`;
    if (key !== renderKey) {
      renderKey = key;
      list.replaceChildren();
      list.hidden = data.images.length === 0;
      for (const image of data.images) {
        const row = document.createElement('li');
        row.className = 'container-row';
        const details = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = image.name;
        const state = document.createElement('p');
        state.className = 'dashboard-status';
        state.textContent = statusLabels[image.status] || image.status;
        details.append(name, state);
        const actions = document.createElement('div');
        actions.className = 'container-actions';
        function action(label: string, callback: () => void) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'dashboard-retry'; button.textContent = label;
          button.setAttribute('aria-label', `${label}: ${image.name}`);
          button.addEventListener('click', callback); actions.append(button);
        }
        if (image.status === 'ready') action('Use image', () => onSelectImage(image.id));
        action('Build output', () => loadLogs(image));
        if (!activeStatuses.includes(image.status)) action('Remove', () => remove(image));
        row.append(details, actions); list.append(row);
      }
      onImagesChanged(data.images.filter(image => image.status === 'ready'));
    }
    controls();
  }

  function schedule() {
    clearTimeout(timer);
    if (!disposed && data?.images.some(image => activeStatuses.includes(image.status))) {
      timer = setTimeout(() => document.visibilityState === 'visible' ? load(true) : schedule(), 5000);
    }
  }

  async function load(background = false) {
    if (busy || disposed) return;
    busy = true;
    if (!background) error.hidden = true;
    controls();
    try {
      const result = await request('/images');
      if (disposed) return;
      if (!Array.isArray(result.images) || !Number.isInteger(result.usage?.builds)
        || !Number.isInteger(result.limits?.maxBuildsPerMonth)) throw new Error('image_builds_unavailable');
      data = result; render();
      if (logId) {
        const image = data?.images.find(image => image.id === logId);
        if (image) await loadLogs(image);
        else { logId = null; logsPanel.hidden = true; }
      }
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
      if (!disposed) { data = null; status.textContent = 'Image status is unavailable.'; showError(cause); }
    } finally { busy = false; controls(); schedule(); }
  }

  async function remove(image: Image) {
    if (busy || disposed) return;
    if (!window.confirm(`Remove “${image.name}” from your saved images? Running containers will keep running.`)) return;
    busy = true; error.hidden = true; controls();
    try { await request(`/images/${image.id}`, { method: 'DELETE' }); }
    catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error"); if (!disposed) showError(cause); }
    finally { busy = false; controls(); }
    if (!disposed && error.hidden) await load();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || disposed || submit.disabled || !form.reportValidity()) return;
    if (new TextEncoder().encode(editor.value).length > 16 * 1024) {
      showError(new Error('image_source_too_large')); return;
    }
    if (context.files?.[0] && context.files?.[0].size > 512 * 1024) {
      showError(new Error('invalid_image_context')); return;
    }
    const body = new FormData();
    body.set('name', document.querySelector<HTMLInputElement>('#image-name')!.value.trim());
    body.set('dockerfile', editor.value);
    if (context.files?.[0]) body.set('context', context.files?.[0]);
    busy = true; error.hidden = true; submit.textContent = 'Submitting…'; controls();
    try {
      const result = await request('/images', { method: 'POST', body });
      if (disposed) return;
      document.querySelector<HTMLInputElement>('#image-name')!.value = '';
      context.value = ''; file.value = '';
      document.querySelector<HTMLDetailsElement>('#custom-images-details')!.open = false;
      data?.images.unshift(result.image); if (data) data.usage.builds++; render();
      status.textContent = 'Image build queued. You can leave this page while it builds.';
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error"); if (!disposed) showError(cause); }
    finally { busy = false; submit.textContent = 'Build image'; controls(); schedule(); }
  });

  file.addEventListener('change', async () => {
    const source = file.files?.[0];
    if (!source) return;
    if (source.size > 16 * 1024) { showError(new Error('image_source_too_large')); file.value = ''; return; }
    try { editor.value = await source.text(); error.hidden = true; }
    catch { showError(new Error('invalid_image_source')); }
  });
  refresh.addEventListener('click', () => load());
  logsPanel.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => { logsPanel.hidden = true; logId = null; });
  function dispose() { disposed = true; clearTimeout(timer); data = null; controls(); }
  return { load, dispose };
}
