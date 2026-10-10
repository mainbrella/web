import type { Container, ContainerData, MachineSize } from './types.ts';

export type Lifecycle = 'ad_hoc' | 'production';
export function dashboardView(search: string) {
  const view = new URLSearchParams(search).get('view');
  return view === 'ad-hoc' || view === 'production' || view === 'build' ? view : 'overview';
}
export const containerLifecycle = (container: Container): Lifecycle => container.lifecycle ?? 'ad_hoc';
export const hourlyCost = (size: Pick<MachineSize, 'computeUnits'>) => size.computeUnits * 0.02;
export const monthlyCost = (size: Pick<MachineSize, 'computeUnits'>) => Math.round(hourlyCost(size) * 720 * 100) / 100;
export function productionCost(data: ContainerData) {
  return data.containers.filter(container => containerLifecycle(container) === 'production' && container.status !== 'stopped')
    .reduce((sum, container) => sum + hourlyCost(data.sizes?.find(size => size.id === container.size) ?? { computeUnits: 1 }), 0);
}
