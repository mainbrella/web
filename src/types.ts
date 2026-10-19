import type { ContainerLimits } from './container-types.ts';
export type { ContainerIdentity, RestoreLaunch, Container, MachineSize, Image, ContainerLimits, UsageBilling, ContainerData, ObservabilityCapabilities, PersistenceCapabilities, ClientOptions, ImageData } from './container-types.ts';
// Browser-facing API contracts. JSON validation remains at the request boundaries.
export interface User {
  id: string;
  email?: string | null;
  name?: string;
}
export interface PrepaidBalance {
  balanceCents: number;
  availableBalanceCents: number;
  reservedBalanceCents: number;
  currency: 'usd';
  spendLimitCents: number;
  monthlyUsageCents: number;
  productionHourlyCents: number;
  fundedRuntimeMs: number | null;
  minimumProductionRuntimeMs: number;
  autoRecharge: {
    enabled: boolean;
    amountCents: number;
    monthlyLimitCents: number;
    spentCents: number;
    status: string;
  };
}
export interface PrepaidBillingConfig {
  configured: boolean;
  minTopupCents: number;
  maxTopupCents: number;
  storage?: import('./storage-billing-data.ts').StorageBilling['pricing'];
}
export interface Subscription {
  cancel_at_period_end?: boolean;
  cancel_at?: number;
  current_period_end?: number;
  items?: { data: { current_period_end?: number }[] };
}
export interface SubscriptionState {
  active: boolean; plan: string; subscription: Subscription | null;
  trial?: { plan: string; expires_at: number };
  valid_until?: number; scheduled_plan?: string; scheduled_change_at?: number;
  cancel_at_period_end?: boolean;
}
export interface BillingConfig {
  configured: boolean;
  usage_configured?: boolean;
  plans?: Record<string, { price: number; name: string; limits: ContainerLimits }>;
}
