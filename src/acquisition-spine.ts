import { readConsent } from './cookie-preferences.ts';
import { firstTouchAttribution } from './acquisition-analytics.ts';
import { API_ORIGIN } from './api-origin.ts';
import { normalizeRepo, validRepo } from './repo-run-contract.ts';

type Variant = 'try_v1' | 'run_v1';
type Attribution = { entryPage: string; variant: Variant; [key: string]: string };
type Intent = { token: string; createdAt: number; repo: string; attribution: Attribution; captured: boolean; linkedAccountId?: string };
const pendingKey = 'mainbrella:acquisition-pending';
const accountKey = 'mainbrella:acquisition-account';
const ttl = 30 * 86_400_000;
const maxIntents = 20;
const allowedCampaign = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'creator'];
const allowedClickIds = ['gclid', 'fbclid', 'msclkid', 'ttclid'];
const memory = new Map<string, Intent>();
const captures = new Map<string, Promise<boolean>>();
const links = new Map<string, Promise<void>>();
let memoryAccount: string | null | undefined;
let identifiedAccount: string | null = null;
let generation = 0;

function accepted() { try { return readConsent() === 'accepted'; } catch { return false; } }
function secureToken() {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
function canonicalRepo(input: string) {
  const repo = normalizeRepo(input).toLowerCase();
  return validRepo(repo) ? repo : null;
}
function validAttribution(value: unknown): value is Attribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.entryPage !== 'string' || !/^\/(?!\/)[A-Za-z0-9/_-]{0,299}$/.test(record.entryPage)
    || (record.variant !== 'try_v1' && record.variant !== 'run_v1')) return false;
  for (const key of allowedCampaign) if (key in record && (typeof record[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(record[key] as string))) return false;
  for (const key of allowedClickIds) if (key in record && (typeof record[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(record[key] as string))) return false;
  return Object.keys(record).every(key => ['entryPage', 'variant', ...allowedCampaign, ...allowedClickIds].includes(key));
}
function validIntent(repoKey: string, value: unknown, now: number): value is Intent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<Intent>;
  return item.repo === repoKey && canonicalRepo(item.repo) === repoKey
    && typeof item.token === 'string' && /^[a-f0-9]{64}$/.test(item.token)
    && typeof item.createdAt === 'number' && Number.isSafeInteger(item.createdAt) && item.createdAt > 0
    && item.createdAt <= now && now - item.createdAt < ttl
    && typeof item.captured === 'boolean' && validAttribution(item.attribution)
    && (item.linkedAccountId === undefined || typeof item.linkedAccountId === 'string' && item.linkedAccountId.length > 0 && item.linkedAccountId.length <= 200);
}
function readPending() {
  const now = Date.now();
  const result: Record<string, Intent> = {};
  for (const [repo, value] of memory) if (validIntent(repo, value, now)) result[repo] = value;
  try {
    const raw = sessionStorage.getItem(pendingKey);
    const stored = raw ? JSON.parse(raw) : null;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [repo, value] of Object.entries(stored)) if (validIntent(repo, value, now)) result[repo] ??= value;
    }
  } catch { /* Session storage is optional; this page's memory remains available. */ }
  const newest = Object.entries(result).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, maxIntents);
  return Object.fromEntries(newest);
}
function writePending(records: Record<string, Intent>, expectedGeneration = generation) {
  if (expectedGeneration !== generation) return false;
  const bounded = Object.fromEntries(Object.entries(records).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, maxIntents));
  memory.clear();
  for (const [repo, item] of Object.entries(bounded)) memory.set(repo, item);
  try { sessionStorage.setItem(pendingKey, JSON.stringify(bounded)); } catch { /* Keep the pending record in memory. */ }
  return true;
}
function updateIntent(repo: string, token: string, update: (item: Intent) => Intent, expectedGeneration: number) {
  if (expectedGeneration !== generation) return false;
  const latest = readPending();
  const current = latest[repo];
  if (!current || current.token !== token) return false;
  latest[repo] = update(current);
  return writePending(latest, expectedGeneration);
}
export function clearAcquisitionTokens() {
  generation++;
  memory.clear(); memoryAccount = null; identifiedAccount = null;
  try { sessionStorage.setItem(pendingKey, '{}'); } catch { /* Best effort cleanup. */ }
  try { sessionStorage.removeItem(pendingKey); } catch { /* Best effort cleanup. */ }
  try { sessionStorage.removeItem(accountKey); } catch { /* Best effort cleanup. */ }
}
function safeAttribution(variant: Variant): Attribution | null {
  const first = firstTouchAttribution();
  if (!first) return null;
  const entryPage = /^\/(?!\/)[A-Za-z0-9/_-]{0,299}$/.test(first.entryPage) ? first.entryPage : '/';
  const result: Attribution = { entryPage, variant };
  for (const key of allowedCampaign) {
    const value = first.campaign[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) result[key] = value;
  }
  for (const key of allowedClickIds) {
    const value = first.campaign[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value)) result[key] = value;
  }
  return result;
}
function fetchWithLimit(url: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1900);
  return fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), keepalive: true, signal: controller.signal }).finally(() => clearTimeout(timer));
}
async function sendCapture(repo: string, item: Intent, requestGeneration: number): Promise<boolean> {
  if (item.captured) return true;
  const existing = captures.get(item.token);
  if (existing) return existing;
  const operation = (async () => {
    try {
      const response = await fetchWithLimit(`${API_ORIGIN}/acquisition/repositories`, {
        token: item.token, repo: item.repo, attribution: item.attribution,
      });
      if (!response.ok || requestGeneration !== generation) return false;
      updateIntent(repo, item.token, current => ({ ...current, captured: true }), requestGeneration);
      const account = identifiedAccount;
      if (account) void linkPendingAcquisition(account);
      return true;
    } catch { return false; }
  })();
  captures.set(item.token, operation);
  try { return await operation; }
  finally { if (captures.get(item.token) === operation) captures.delete(item.token); }
}

export async function captureRepository(input: string, variant: Variant): Promise<void> {
  if (!accepted()) return;
  const repo = canonicalRepo(input);
  if (!repo) return;
  let pending = readPending();
  let item = pending[repo];
  if (!item) {
    const attribution = safeAttribution(variant);
    if (!attribution) return;
    const token = secureToken();
    if (!token) return;
    item = { token, createdAt: Date.now(), repo, attribution, captured: false };
    pending[repo] = item;
    pending = Object.fromEntries(Object.entries(pending).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, maxIntents));
  }
  writePending(pending);
  const requestGeneration = generation;
  await sendCapture(repo, item, requestGeneration);
  if (identifiedAccount && item.linkedAccountId !== identifiedAccount) void linkPendingAcquisition(identifiedAccount);
}

async function linkIntent(repo: string, item: Intent, accountId: string, requestGeneration: number): Promise<void> {
  if (requestGeneration !== generation || identifiedAccount !== accountId || item.linkedAccountId === accountId) return;
  const key = `${item.token}:${accountId}`;
  const existing = links.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const captured = item.captured || await sendCapture(repo, item, requestGeneration);
    if (!captured || requestGeneration !== generation || identifiedAccount !== accountId) return;
    try {
      const response = await fetchWithLimit(`${API_ORIGIN}/acquisition/link`, { token: item.token });
      if (!response.ok || requestGeneration !== generation || identifiedAccount !== accountId) return;
      updateIntent(repo, item.token, current => ({ ...current, captured: true, linkedAccountId: accountId }), requestGeneration);
    } catch { /* Authentication and navigation never depend on optional acquisition writes. */ }
  })();
  links.set(key, operation);
  try { await operation; }
  finally { if (links.get(key) === operation) links.delete(key); }
}

export async function linkPendingAcquisition(accountId: string): Promise<void> {
  if (!accepted() || !accountId || accountId.length > 200) return;
  let previous = memoryAccount;
  try { previous ??= sessionStorage.getItem(accountKey) ?? undefined; } catch { /* Memory fallback. */ }
  if (previous && previous !== accountId) clearAcquisitionTokens();
  memoryAccount = accountId;
  identifiedAccount = accountId;
  const requestGeneration = generation;
  try { sessionStorage.setItem(accountKey, accountId); } catch { /* Account tracking is best effort. */ }
  const pending = readPending();
  writePending(pending, requestGeneration);
  await Promise.all(Object.entries(pending).map(([repo, item]) => linkIntent(repo, item, accountId, requestGeneration)));
}

if (typeof window !== 'undefined') window.addEventListener('cookie-consent-change', event => {
  if ((event as CustomEvent).detail?.choice === 'rejected') clearAcquisitionTokens();
});
