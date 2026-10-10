import { normalizeRepo, validRepo } from './repo-run-contract.ts';

export const TRY_PROMOTION_CODE = 'BRELLA-GIT-TRY5';
export const TRY_CREDIT_CENTS = 500;
export type RepoFunding = { repo: string; returnTo: string };

export function readRepoFunding(value: unknown, origin: string): RepoFunding | null {
  if (!value || typeof value !== 'object') return null;
  const { repo, returnTo } = value as Record<string, unknown>;
  if (typeof repo !== 'string' || !validRepo(normalizeRepo(repo))
    || typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  try {
    const destination = new URL(returnTo, origin);
    if (destination.origin !== origin || destination.pathname !== '/run/') return null;
    return { repo: normalizeRepo(repo), returnTo: destination.pathname + destination.search + destination.hash };
  } catch { return null; }
}

export function repoFundingUrl(repo: string, destination: URL): string {
  destination = new URL(destination);
  destination.searchParams.delete('prepare');
  const url = new URL('/pricing/usage/', destination.origin);
  url.searchParams.set('flow', 'try');
  url.searchParams.set('repo', normalizeRepo(repo));
  url.searchParams.set('returnTo', destination.pathname + destination.search + destination.hash);
  return url.pathname + url.search;
}
