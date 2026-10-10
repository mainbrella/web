import { API_ORIGIN } from './api-origin.ts';

export type BuildActivity = { id: string; type: 'message' | 'tool'; text: string; status: 'running' | 'succeeded' | 'failed' };
export type BuildTurn = {
  id: string; prompt: string; mode: 'build' | 'preview'; status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string; summary: string | null; error: string | null; log: string; model: string;
  inputTokens: number; outputTokens: number; createdAt: string; finishedAt: string | null;
  activity?: BuildActivity[];
};
export type BuildApp = {
  id: string; name: string; prompt: string; revision: number; activeTurnId: string | null;
  container: { id: string; createdAt: string; expiresAt: string } | null;
  preview: { id: string; url: string; expiresAt: number } | null;
  createdAt: string; updatedAt: string; turns?: BuildTurn[];
};
export type BuildConfig = { available: boolean; model: string; maxApps: number; dailyTurns: number; aiBilling: 'included'; computeUnitHourlyCents: number; size: 'small' };
export type BuildSource = { revision: number; files: Record<string, string> };
export class BuildAPIError extends Error {
  constructor(public code: string) { super(buildErrorMessage(code)); }
}
export function buildErrorMessage(code: string): string {
  return ({
    subscription_required: 'Add prepaid balance to build and run apps.',
    build_unavailable: 'Build is unavailable right now. Please try again shortly.',
    build_busy: 'Another build is running in your account. Wait for it to finish.',
    revision_conflict: 'This app changed in another tab. Reload the app before trying again.',
    build_daily_limit: 'You have reached the daily build limit. Try again tomorrow (UTC).',
    build_app_limit: 'You have reached the 50-app limit. Delete an app to make room.',
    build_turn_limit: 'This app has reached its 100-build limit. Export its source to keep working on it.',
    app_not_found: 'This app is no longer available.',
    container_not_running: 'The sandbox stopped. Your source is saved; start a new preview or ask for a change.',
    build_budget_exceeded: 'The build reached its limit. Your edits are saved; try a smaller change or ask to fix the build.',
    model_response_incomplete: 'The model response was incomplete. Your source is saved; try again.',
    build_check_failed: 'The app did not pass its build check. Ask Build to fix the errors shown in Logs.',
    build_interrupted: 'The build was interrupted. Your source is saved; try again.',
    preview_start_failed: 'The app built, but its preview could not start. Try again.',
    invalid_request: 'Check your app name or prompt and try again.',
    source_limit: 'This app has reached the source size limit. Try a smaller change.',
    build_command_timeout: 'A build command took too long. Your source is saved; try again.',
    build_runtime_unavailable: 'The sandbox could not start. Check your balance and try again.',
    build_failed: 'The build could not finish. Your source is saved; try again.',
    network: 'Could not reach Build. Check your connection and try again.',
  } as Record<string, string>)[code] || 'Could not complete that action. Please try again.';
}
export function safeBuildPreviewURL(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' && !url.port && /^[a-f0-9]{48}\.mainbrella\.dev$/.test(host)) return url.href;
    if (url.protocol === 'http:' && /^[a-f0-9]{48}\.localhost$/.test(host)) return url.href;
  } catch { /* Invalid server URL. */ }
  return null;
}
export function createBuildClient(onUnauthenticated: () => void, signal?: AbortSignal) {
  async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_ORIGIN}/build${path}`, { method, credentials: 'include', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new BuildAPIError('network');
    }
    const result = await response.json().catch(() => null);
    if (response.status === 401) onUnauthenticated();
    if (!response.ok) throw new BuildAPIError(result?.error || 'build_unavailable');
    if (!result || typeof result !== 'object') throw new BuildAPIError('build_unavailable');
    return result as T;
  }
  const appPath = (id: string) => `/apps/${encodeURIComponent(id)}`;
  return {
    config: () => request<BuildConfig>('/config'),
    list: () => request<{ apps: BuildApp[] }>('/apps'),
    read: (id: string) => request<{ app: BuildApp }>(appPath(id)),
    create: (prompt: string, key: string) => request<{ app: BuildApp }>('/apps', 'POST', { prompt }, key),
    turn: (app: BuildApp, prompt: string, key: string) => request<{ app: BuildApp }>(`${appPath(app.id)}/turns`, 'POST', { mode: 'build', prompt, revision: app.revision }, key),
    preview: (app: BuildApp, key: string) => request<{ app: BuildApp }>(`${appPath(app.id)}/turns`, 'POST', { mode: 'preview', revision: app.revision }, key),
    resume: (id: string) => request<{ app: BuildApp }>(`${appPath(id)}/resume`, 'POST'),
    rename: (id: string, name: string) => request<{ app: BuildApp }>(appPath(id), 'PATCH', { name }),
    stop: (id: string) => request<{ app: BuildApp }>(`${appPath(id)}/stop`, 'POST'),
    remove: (id: string) => request<{ deleted: true }>(appPath(id), 'DELETE'),
    source: (id: string) => request<BuildSource>(`${appPath(id)}/source`),
    watch(id: string, onApp: (app: BuildApp) => void, onDisconnect: () => void) {
      const events = new EventSource(`${API_ORIGIN}/build${appPath(id)}/events`, { withCredentials: true });
      const stop = () => { events.close(); signal?.removeEventListener('abort', stop); };
      events.addEventListener('app', event => {
        if (signal?.aborted) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.app?.id !== id || !Array.isArray(data.app.turns)) throw new Error('Invalid build progress');
          onApp(data.app as BuildApp);
        } catch { stop(); onDisconnect(); }
      });
      events.onerror = () => { stop(); if (!signal?.aborted) onDisconnect(); };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      return stop;
    },
    async export(id: string): Promise<Blob> {
      let response: Response;
      try { response = await fetch(`${API_ORIGIN}/build${appPath(id)}/export`, { credentials: 'include', redirect: 'error', signal }); }
      catch (error) { if (signal?.aborted) throw error; throw new BuildAPIError('network'); }
      if (response.status === 401) onUnauthenticated();
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new BuildAPIError(result?.error || 'build_unavailable');
      }
      return response.blob();
    },
  };
}
