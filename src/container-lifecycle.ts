import { API_ORIGIN } from './platform.ts';
import type { ClientOptions, Container, ContainerData, ContainerIdentity, PersistenceCapabilities } from './container-types.ts';

export type ContainerAction = 'stop' | 'resume' | 'fork';

export function canResumeContainer(container: Container, capabilities: PersistenceCapabilities, now = Date.now()) {
  return capabilities.filesystemAfterStop === true && container.status === 'stopped'
    && typeof container.workspaceId === 'string' && typeof container.persistenceExpiresAt === 'number'
    && container.persistenceExpiresAt > now;
}

export function createLifecycleClient({ fetcher = fetch, onUnauthenticated }: ClientOptions = {}) {
  return async (action: ContainerAction, container: ContainerIdentity, key: string, name?: string): Promise<ContainerData> => {
    const response = await fetcher(`${API_ORIGIN}/containers/${action}`, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ id: container.id, createdAt: container.createdAt, ...(name !== undefined ? { name } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 401) onUnauthenticated?.();
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'lifecycle_unavailable');
    if (!Array.isArray(result?.containers) || !Number.isInteger(result.usage?.starts)
      || !Number.isInteger(result.limits?.maxStartsPerMonth)) throw new Error('invalid_response');
    return result;
  };
}

export function lifecycleError(code: string) {
  const messages: Record<string, string> = {
    workspace_expired: 'This saved filesystem has expired. Delete this machine and create a new one.',
    workspace_image_incompatible: 'The image version needed to restore these files is no longer available.',
    workspace_quota_exceeded: 'There is not enough saved-workspace storage to save this filesystem.',
    workspace_save_limit: 'Your monthly workspace save allowance is used up.',
    workspace_capture_budget_exceeded: 'Your monthly filesystem capture allowance is used up.',
    workspace_retained_budget_exceeded: 'Your filesystem capture allowance is full until earlier saves age out.',
    container_not_running: 'This machine is no longer running. Refresh to check its state.',
    container_not_stopped: 'This machine is no longer stopped. Refresh to check its state.',
    container_limit_exceeded: 'Your running container limit is reached. Stop a machine before trying again.',
    compute_capacity_exceeded: 'There is not enough available concurrent compute for this machine.',
    subscription_required: 'Add prepaid balance to start this machine.',
    spend_limit_reached: 'Add balance or increase your monthly spending cap to start this machine.',
    filesystem_persistence_unavailable: 'Filesystem stop and resume are unavailable in this environment.',
    persistence_unavailable: 'Filesystem stop, resume, and forks are unavailable in this environment.',
    filesystem_fork_unavailable: 'Filesystem forks are unavailable in this environment.',
    idempotency_conflict: 'This request conflicts with an earlier attempt. Refresh to check the current state.',
  };
  return messages[code] ?? 'The action could not be confirmed. Refresh to check its result, then retry the same action if needed.';
}
