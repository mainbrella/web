import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStorageBytes, readStorageBilling, type StorageBilling } from './storage-billing-data.ts';

const sample = (): StorageBilling => ({ month: '2026-10', maxBytes: 2000000000000,
  pricing: { mode: 'meter', markupBps: 2000, chargeFrom: null, retentionDays: 7, storageUsdPerGbMonth: 0.015, classAUsdPerMillion: 4.5, classBUsdPerMillion: 0.36 },
  projects: [{ appId: 'app', name: 'Example app', storedBytes: 1000000000000, sourceAssetsBytes: 100000000000, historyBytes: 900000000000,
    chargedCents: 600, estimatedMonthlyCents: 1800, cloudflareCents: 500, markupCents: 100, adjustmentCents: -12,
    reads: 100, writes: 20, fundedThrough: null, writesBlocked: false }] });
test('storage shows decimal GB and validates signed invoice credits and configured pricing', () => {
  assert.equal(formatStorageBytes(1000000000000), '1 TB');
  assert.equal(formatStorageBytes(1000000000), '1 GB');
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(readStorageBilling(sample()).projects[0].adjustmentCents, -12);
  for (const mutate of [
    (value: StorageBilling) => { value.projects[0].storedBytes++; },
    (value: StorageBilling) => { value.projects[0].reads = -1; },
    (value: StorageBilling) => { value.projects[0].fundedThrough = Infinity; },
    (value: StorageBilling) => { value.pricing.markupBps = 10001; },
    (value: StorageBilling) => { value.projects[0].estimatedMonthlyCents = NaN; },
  ]) { const data = sample(); mutate(data); assert.throws(() => readStorageBilling(data)); }
});

test('30-day retention and download URLs validate without permitting external download destinations', () => {
  const data = sample();
  data.pricing.retentionDays = 30;
  data.retention = { writesBlocked: true, deletionAt: Date.now() + 30 * 86400000, warningDeliveredAt: Date.now(), expiredAt: null, notice: 'Add funds or download before the deadline.' };
  data.projects[0].exportUrl = `/build/apps/${data.projects[0].appId}/repository`;
  assert.equal(readStorageBilling(data), data);
  data.projects[0].exportUrl = 'https://example.com/download';
  assert.throws(() => readStorageBilling(data), /storage_unavailable/);
});
