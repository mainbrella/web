// Browser-facing API contracts. JSON validation remains at the request boundaries.
export interface User {
  id: string;
  email?: string | null;
  name?: string;
}
export interface ContainerIdentity { id: string; createdAt: string }
export interface Container extends ContainerIdentity {
  imageName?: string;
  name?: string;
  status: string;
  expiresAt: number;
  size?: string;
}
export interface MachineSize {
  id: string; name: string; cpuVcpu: number; diskGB: number;
  computeUnits: number; memoryMiB: number;
}
export interface Image { id: string; name: string; status: string; createdAt?: string }
export interface ContainerLimits {
  maxContainers: number;
  maxStartsPerMonth: number;
  maxSessionMs: number;
  idleTimeoutMs: number;
  maxConcurrentComputeUnits?: number;
  maxComputeUnitHours?: number;
}
export interface ContainerData {
  active: boolean;
  containers: Container[];
  usage: { starts: number; computeUnitHours: number; reservedComputeUnitHours: number; availableComputeUnitHours?: number; concurrentComputeUnits?: number };
  limits: ContainerLimits;
  sizes?: MachineSize[];
  imageCatalog?: { id: string; name: string }[];
}
export interface ObservabilityCapabilities { lifecycleEvents?: boolean; metrics?: boolean; webhooks?: boolean }
export interface PersistenceCapabilities { workspaces?: boolean; snapshots?: boolean }
export interface ClientOptions { fetcher?: typeof fetch; onUnauthenticated?: () => void; signal?: AbortSignal }
export interface ImageData {
  buildsEnabled: boolean;
  images: Image[];
  usage: { builds: number };
  limits: { maxBuildsPerMonth: number; maxSavedImages: number };
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
  plans?: Record<string, { price: number; name: string; limits: ContainerLimits }>;
}
