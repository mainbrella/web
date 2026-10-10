import type { PrepaidBalance } from './types.ts';
import { readPrepaidBalance } from './prepaid-billing.ts';

export interface BalanceResource {
  id: string;
  containerId: string;
  name: string | null;
  lifecycle: 'ad_hoc' | 'production';
  size: string;
  startAt: number;
  endAt: number | null;
  runtimeMs: number;
  computeUnitHours: number;
  usedCents: number;
  reservedCents: number;
  hourlyCents: number;
  active: boolean;
}
export interface BalanceFunding {
  id: string;
  createdAt: number;
  amountCents: number;
  revokedCents: number;
  reason: 'refund' | 'dispute' | null;
}
export interface BalanceHistory {
  asOf: number;
  balance: PrepaidBalance;
  totals: { fundedCents: number; revokedCents: number; usedCents: number; unattributedUsedCents: number; inferenceUsedCents?: number };
  currentHourlyCents: number;
  activeResources: BalanceResource[];
  resources: BalanceResource[];
  fundings: BalanceFunding[];
  nextResourceCursor: string | null;
  nextFundingCursor: string | null;
  historyTruncated: boolean;
  retainedResourceLimit: number;
}

const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const cents = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const timestamp = (value: unknown): value is number => cents(value) && value <= 8.64e15;
const cursor = (value: unknown) => value === null || identifier(value);
const invalid = () => { throw new Error('history_unavailable'); };

export function readBalanceHistory(value: unknown): BalanceHistory {
  if (!value || typeof value !== 'object') return invalid();
  const data = value as BalanceHistory;
  readPrepaidBalance(data.balance);
  if (!timestamp(data.asOf) || !data.totals || !Object.values(data.totals).every(nonnegative)
    || !cents(data.totals.fundedCents) || !cents(data.totals.revokedCents)
    || !nonnegative(data.totals.usedCents) || !nonnegative(data.totals.unattributedUsedCents)
    || data.totals.inferenceUsedCents !== undefined && (!nonnegative(data.totals.inferenceUsedCents) || data.totals.inferenceUsedCents + data.totals.unattributedUsedCents > data.totals.usedCents + 1e-7)
    || data.totals.revokedCents > data.totals.fundedCents
    || data.totals.unattributedUsedCents > data.totals.usedCents + 1e-7
    || !nonnegative(data.currentHourlyCents) || typeof data.historyTruncated !== 'boolean'
    || !cents(data.retainedResourceLimit) || data.retainedResourceLimit < 1
    || !cursor(data.nextResourceCursor) || !cursor(data.nextFundingCursor)) return invalid();
  const unroundedBalance = data.totals.fundedCents - data.totals.revokedCents - data.totals.usedCents;
  if (unroundedBalance < data.balance.balanceCents - 1e-7
    || unroundedBalance > data.balance.balanceCents + 1 + 1e-7) return invalid();
  for (const resources of [data.activeResources, data.resources]) {
    if (!Array.isArray(resources) || resources.length > 500) return invalid();
    for (const resource of resources) {
      if (!resource || !identifier(resource.id) || !identifier(resource.containerId) || !identifier(resource.size)
        || (resource.name !== null && (typeof resource.name !== 'string' || resource.name.length > 80))
        || !['ad_hoc', 'production'].includes(resource.lifecycle) || typeof resource.active !== 'boolean'
        || !timestamp(resource.startAt) || (resource.endAt !== null && (!timestamp(resource.endAt) || resource.endAt < resource.startAt))
        || !nonnegative(resource.runtimeMs) || !nonnegative(resource.computeUnitHours)
        || !nonnegative(resource.usedCents) || !nonnegative(resource.reservedCents) || !nonnegative(resource.hourlyCents)) return invalid();
    }
  }
  if (!Array.isArray(data.fundings) || data.fundings.length > 100) return invalid();
  for (const funding of data.fundings) {
    if (!funding || !identifier(funding.id) || !timestamp(funding.createdAt)
      || !cents(funding.amountCents) || !cents(funding.revokedCents) || funding.revokedCents > funding.amountCents
      || ![null, 'refund', 'dispute'].includes(funding.reason)) return invalid();
  }
  return data;
}

export function formatRuntimeCost(cents: number): string {
  if (cents > 0 && cents < 0.01) return '<$0.0001';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function formatRuntime(milliseconds: number): string {
  if (milliseconds === 0) return '0 sec';
  if (milliseconds < 1000) return '<1 sec';
  if (milliseconds < 60000) return `${Math.floor(milliseconds / 1000)} sec`;
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours.toLocaleString('en-US')} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
