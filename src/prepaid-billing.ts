import type { PrepaidBalance } from './types.ts';

export const formatBalance = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function readPrepaidBalance(value: unknown): PrepaidBalance {
  if (!value || typeof value !== 'object') throw new Error('balance_unavailable');
  const data = value as PrepaidBalance;
  const nonnegative = (amount: unknown): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
  const cents = (amount: unknown) => nonnegative(amount) && Number.isSafeInteger(amount);
  if (!Number.isSafeInteger(data.balanceCents) || data.currency !== 'usd'
    || !cents(data.availableBalanceCents) || !cents(data.reservedBalanceCents)
    || !cents(data.spendLimitCents) || !cents(data.monthlyUsageCents)
    || !nonnegative(data.productionHourlyCents)
    || (data.fundedRuntimeMs !== null && !nonnegative(data.fundedRuntimeMs))
    || !nonnegative(data.minimumProductionRuntimeMs)
    || !data.autoRecharge || typeof data.autoRecharge.enabled !== 'boolean'
    || !cents(data.autoRecharge.amountCents) || !cents(data.autoRecharge.monthlyLimitCents)
    || !cents(data.autoRecharge.spentCents) || typeof data.autoRecharge.status !== 'string') {
    throw new Error('balance_unavailable');
  }
  return data;
}

export function dollarsToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function stripeCheckoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_checkout');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) {
    throw new Error('invalid_checkout');
  }
  return url.href;
}
