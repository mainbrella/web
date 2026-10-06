export interface StatusObservation { component: string; state: string; checkedAt?: string; stale?: boolean; scope?: string }
export interface PublicStatus { generatedAt?: string; staleAfterMs?: number; components: StatusObservation[]; incidents: { title: string; state: string; message: string; component: string; updated_at: string }[] }
export interface HistoryCursor { before: string; beforeId: number }
export interface PublicHistory { observations: StatusObservation[]; next: HistoryCursor | null }
export const components: Record<string, string> = {
  website: 'Website', api: 'API', auth: 'Authentication', provisioning: 'Container provisioning',
  ssh: 'SSH gateway', images: 'Image builds', billing: 'Billing',
};
const states = new Set(['operational', 'degraded', 'outage', 'unknown']);
export function currentComponents(status: Partial<PublicStatus> | null, now = Date.now()) {
  const freshness = Math.min((status?.staleAfterMs ?? 0) > 0 ? status!.staleAfterMs! : 900_000, 900_000);
  return Object.entries(components).map(([component, name]) => {
    const record = status?.components?.find(item => item?.component === component);
    const timestamp = Date.parse(record?.checkedAt ?? "");
    const fresh = Number.isFinite(timestamp) && timestamp <= now && now - timestamp < freshness && record?.stale !== true;
    return { ...record, component, name, state: fresh && states.has(record?.state ?? "") ? record!.state : 'unknown' };
  });
}
export function historyPath(input: unknown) {
  const next = input as HistoryCursor | null;
  if (next === null) return null;
  if (!next || !Number.isFinite(Date.parse(next.before)) || new Date(next.before).toISOString() !== next.before || !Number.isSafeInteger(next.beforeId) || next.beforeId < 1) throw new Error('Invalid history cursor');
  return `/status/history?${new URLSearchParams({ before: next.before, beforeId: String(next.beforeId) })}`;
}
export async function readPublicStatus<P extends string>(path: P, { origin, fetcher = fetch }: { origin: string; fetcher?: typeof fetch }): Promise<P extends "/status" ? PublicStatus : PublicHistory> {
  const response = await fetcher(new URL(path, origin), {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Status unavailable');
  const data = await response.json();
  if (path === '/status') {
    if (!Array.isArray(data?.components) || !Array.isArray(data?.incidents)) throw new Error('Status unavailable');
  } else {
    if (!Array.isArray(data?.observations)) throw new Error('History unavailable');
    historyPath(data.next);
  }
  return data;
}
