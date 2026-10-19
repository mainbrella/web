// Browser-facing Linux API contracts. Validation stays at request boundaries.
export interface ContainerIdentity { id: string; createdAt: string }
export interface RestoreLaunch { command: string; cwd?: string; readiness: { port: number; path?: string; timeoutMs?: number } }
export interface Container extends ContainerIdentity {
  imageName?: string;
  name?: string;
  status: string;
  expiresAt: string | number;
  lifecycle?: 'ad_hoc' | 'production';
  stopReason?: string;
  size?: string;
  workspaceId?: string;
  persistenceExpiresAt?: number;
  internet?: boolean;
  launch?: RestoreLaunch;
  readiness?: { status: 'starting' | 'ready' | 'failed'; port: number; path: string; logPath: string; checkedAt?: string; error?: string; logTail?: string };
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
  maxComputeUnitHours?: number | null;
}
export interface UsageBilling {
  periodStart: number; periodEnd: number; computeUnitHours: number; estimatedCents: number;
  minimumCents: number; spendLimitCents: number; committedCents: number; alert: 50 | 80 | 100 | null; overagesEnabled: boolean; invoicingPending: boolean;
  balanceCents?: number; availableBalanceCents?: number; reservedBalanceCents?: number;
  monthlyUsageCents?: number; productionHourlyCents?: number; fundedRuntimeMs?: number | null;
  minimumProductionRuntimeMs?: number;
}
export interface ContainerData {
  billing?: UsageBilling | null;
  active: boolean;
  plan?: string | null;
  containers: Container[];
  usage: { starts: number; computeUnitHours: number; reservedComputeUnitHours: number; availableComputeUnitHours?: number; concurrentComputeUnits?: number };
  limits: ContainerLimits;
  sizes?: MachineSize[];
  imageCatalog?: { id: string; name: string }[];
}
export interface ObservabilityCapabilities { lifecycleEvents?: boolean; metrics?: boolean; webhooks?: boolean }
export interface PersistenceCapabilities { workspaces?: boolean; snapshots?: boolean; filesystemAfterStop?: boolean; filesystemFork?: boolean; restoreLaunch?: boolean; startupConfiguration?: boolean }
export interface ClientOptions { fetcher?: typeof fetch; onUnauthenticated?: () => void; signal?: AbortSignal }
export interface ImageData {
  buildsEnabled: boolean;
  images: Image[];
  usage: { builds: number };
  limits: { maxBuildsPerMonth: number; maxSavedImages: number };
}
