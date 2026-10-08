export interface RepoRunOptions {
  repo: string; ref?: string; catalogId?: string; size: string; cwd: string;
  setupCommand?: string; startCommand?: string; port?: number;
}
export interface RepositoryLaunch {
  id: string; phase: 'allocating' | 'cloning' | 'setup' | 'starting' | 'ready' | 'failed' | 'stopped';
  options: RepoRunOptions;
  repository: { repo: string; ref: string; commit: string; suggestedCatalogId: string; manifests: string[] };
  container: { id: string; createdAt: string; expiresAt: string } | null;
  executions: Partial<Record<'cloning' | 'setup' | 'starting', string>>;
  shellReadyAt: number | null; previewReadyAt: number | null; createdAt: number; error: string | null;
}
export interface RepoRunExecutionDiagnostics {
  status: string; exitCode: number | null; timedOut: boolean; outputTruncated: boolean;
}
export type RepoRunDiagnostics = Partial<Record<keyof RepositoryLaunch['executions'], RepoRunExecutionDiagnostics>>;
export function normalizeRepo(value: string): string {
  return value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
}
export function repoRunUrl(options: RepoRunOptions, origin: string): URL {
  const url = new URL('/run/', origin);
  url.searchParams.set('repo', normalizeRepo(options.repo));
  for (const key of ['ref', 'catalogId', 'size', 'cwd', 'setupCommand', 'startCommand', 'port'] as const) {
    const value = options[key];
    if (value !== undefined && value !== '' && !(key === 'size' && value === 'small') && !(key === 'cwd' && value === '.')) url.searchParams.set(key, String(value));
  }
  return url;
}
export function launchIdentity(hash: string): { kind: 'launch' | 'request'; id: string } | null {
  const match = /^#(launch|request)=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(hash);
  return match ? { kind: match[1] as 'launch' | 'request', id: match[2] } : null;
}
