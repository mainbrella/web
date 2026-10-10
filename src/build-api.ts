import { API_ORIGIN } from './api-origin.ts';

export type BuildActivity = { id: string; type: 'message' | 'tool'; text: string; status: 'running' | 'succeeded' | 'failed' };
export type BuildImage = { id: string; toolId: string; label: string; path: string };
export type BuildTurn = {
  id: string; prompt: string; mode: 'build' | 'preview'; status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string; summary: string | null; error: string | null; log: string; model: string; effort?: string | null;
  inputTokens: number; outputTokens: number; createdAt: string; finishedAt: string | null;
  aiCostCents?: number;
  activity?: BuildActivity[];
  images?: BuildImage[];
};
export type BuildApp = {
  id: string; name: string; prompt: string; revision: number; activeTurnId: string | null;
  container: { id: string; createdAt: string; expiresAt: string } | null;
  preview: { id: string; url: string; expiresAt: number } | null;
  createdAt: string; updatedAt: string; turns?: BuildTurn[];
};
export type BuildModel = { id: string; name: string; description?: string; efforts: string[]; defaultEffort: string };
export type BuildModelOptions = { model?: string; effort?: string };
export type BuildConfig = { available: boolean; model: string; models?: BuildModel[]; maxApps: number; dailyTurns: number; aiBilling: 'included' | 'prepaid'; aiMarkupPercent: number; computeUnitHourlyCents: number; size: 'small' };
export type BuildSource = { revision: number; files: Record<string, string> };
export class BuildAPIError extends Error {
  constructor(public code: string, public details?: string) { super(buildErrorMessage(code, details)); }
}
export function buildErrorMessage(code: string, details?: string | null): string {
  const message = ({
    invalid_build_model: 'Choose an available Build model and try again.',
    invalid_build_effort: 'Choose a supported effort for this model and try again.',
    subscription_required: 'Add prepaid balance to build and run apps.',
    insufficient_balance: 'Your prepaid balance is too low to continue. Add balance and try again.',
    spend_limit_exceeded: 'Your spending limit has been reached. Increase the limit to continue building.',
    build_billing_unavailable: 'Could not check your prepaid balance. Try again shortly.',
    build_billing_reconciliation_required: 'An AI request needs billing reconciliation. Your source is saved; contact support.',
    build_model_unpriced: 'Build is unavailable right now. Please try again shortly.',
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
    invalid_model_response: 'The model returned an invalid response. Your source is saved; try again.',
    build_inference_timeout: 'The model took too long to respond. Your source is saved; try again.',
    build_inference_disconnected: 'The connection to the model was lost. Your source is saved; try again.',
    build_check_failed: 'The app did not pass its build check. Ask Build to fix the build errors.',
    build_interrupted: 'The build was interrupted. Your source is saved; try again.',
    preview_start_failed: 'The app built, but its preview could not start. Try again.',
    invalid_request: 'Check your app name or prompt and try again.',
    source_limit: 'This app has reached the source size limit. Try a smaller change.',
    build_command_timeout: 'A build command took too long. Your source is saved; try again.',
    build_runtime_unavailable: 'The sandbox could not start. Check your balance and try again.',
    build_failed: 'The build could not finish. Your source is saved; try again.',
    network: 'Could not reach Build. Check your connection and try again.',
  } as Record<string, string>)[code] || (code.trim() ? `Build error: ${code}` : 'Could not complete that action. Please try again.');
  const output = details?.trim();
  return output && output !== code && output !== message ? `${message}\n\n${output}` : message;
}

function buildResponseError(result: unknown): BuildAPIError {
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const code = typeof data.error === 'string' && data.error.trim() ? data.error : 'build_unavailable';
  const details = [data.message, data.details].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  return new BuildAPIError(code, [...new Set(details)].filter(value => value !== code).join('\n\n'));
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
    if (!response.ok) throw buildResponseError(result);
    if (!result || typeof result !== 'object') throw new BuildAPIError('build_unavailable');
    return result as T;
  }
  const appPath = (id: string) => `/apps/${encodeURIComponent(id)}`;
  return {
    config: () => request<BuildConfig>('/config'),
    list: () => request<{ apps: BuildApp[] }>('/apps'),
    read: (id: string) => request<{ app: BuildApp }>(appPath(id)),
    create: (prompt: string, key: string, options: BuildModelOptions = {}) => request<{ app: BuildApp }>('/apps', 'POST', { prompt, ...options }, key),
    turn: (app: BuildApp, prompt: string, key: string, options: BuildModelOptions = {}) => request<{ app: BuildApp }>(`${appPath(app.id)}/turns`, 'POST', { mode: 'build', prompt, revision: app.revision, ...options }, key),
    preview: (app: BuildApp, key: string) => request<{ app: BuildApp }>(`${appPath(app.id)}/turns`, 'POST', { mode: 'preview', revision: app.revision }, key),
    resume: (id: string) => request<{ app: BuildApp }>(`${appPath(id)}/resume`, 'POST'),
    rename: (id: string, name: string) => request<{ app: BuildApp }>(appPath(id), 'PATCH', { name }),
    stop: (id: string) => request<{ app: BuildApp }>(`${appPath(id)}/stop`, 'POST'),
    remove: (id: string) => request<{ deleted: true }>(appPath(id), 'DELETE'),
    source: (id: string) => request<BuildSource>(`${appPath(id)}/source`),
    imageURL: (appId: string, imageId: string) => /^[a-f0-9-]{36}$/.test(appId) && /^[a-f0-9-]{36}$/.test(imageId)
      ? `${API_ORIGIN}/build${appPath(appId)}/images/${imageId}` : null,
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
        throw buildResponseError(result);
      }
      return response.blob();
    },
  };
}
