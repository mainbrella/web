export interface StorageProject {
  appId: string; name: string | null; storedBytes: number; sourceAssetsBytes: number; historyBytes: number;
  chargedCents: number; estimatedMonthlyCents: number; cloudflareCents: number; markupCents: number; adjustmentCents: number;
  reads: number; writes: number; fundedThrough: number | null; writesBlocked: boolean;
}
export interface StorageBilling {
  month: string; maxBytes: number;
  pricing: { mode: 'off' | 'meter' | 'charge'; markupBps: number; chargeFrom: number | null; retentionDays: number;
    storageUsdPerGbMonth: number; classAUsdPerMillion: number; classBUsdPerMillion: number };
  projects: StorageProject[];
}
export function readStorageBilling(value: unknown): StorageBilling {
  const invalid = () => { throw new Error('storage_unavailable'); };
  const nonnegative = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number) && number >= 0;
  const integer = (number: unknown) => nonnegative(number) && Number.isSafeInteger(number);
  const signed = (number: unknown) => typeof number === 'number' && Number.isFinite(number);
  const timestamp = (number: unknown) => number === null || integer(number) && Number(number) <= 8.64e15;
  if (!value || typeof value !== 'object') return invalid();
  const data = value as StorageBilling, pricing = data.pricing;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(data.month) || !integer(data.maxBytes) || !pricing
    || !['off', 'meter', 'charge'].includes(pricing.mode) || !integer(pricing.markupBps) || pricing.markupBps > 10000
    || !timestamp(pricing.chargeFrom) || pricing.retentionDays !== 7
    || ![pricing.storageUsdPerGbMonth, pricing.classAUsdPerMillion, pricing.classBUsdPerMillion].every(nonnegative)
    || !Array.isArray(data.projects) || data.projects.length > 1000) return invalid();
  for (const row of data.projects) {
    if (!row || typeof row.appId !== 'string' || !row.appId || row.appId.length > 128 || row.name !== null && (typeof row.name !== 'string' || row.name.length > 200)
      || ![row.storedBytes, row.sourceAssetsBytes, row.historyBytes, row.reads, row.writes].every(integer)
      || row.sourceAssetsBytes + row.historyBytes !== row.storedBytes
      || ![row.estimatedMonthlyCents, row.cloudflareCents, row.markupCents].every(nonnegative)
      || ![row.chargedCents, row.adjustmentCents].every(signed) || !timestamp(row.fundedThrough) || typeof row.writesBlocked !== 'boolean') return invalid();
  }
  return data;
}
export function formatStorageBytes(bytes: number) {
  if (!bytes) return '0 B';
  const index = Math.min(4, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** index).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
