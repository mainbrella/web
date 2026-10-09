import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardView, containerLifecycle, monthlyCost, productionCost } from './dashboard-view.ts';

test('dashboard links select workload modes and unknown views show the overview', () => {
  assert.equal(dashboardView(''), 'overview');
  assert.equal(dashboardView('?view=production'), 'production');
  assert.equal(dashboardView('?view=ad-hoc'), 'ad-hoc');
  assert.equal(dashboardView('?view=unknown'), 'overview');
});

test('production estimates use allocated size, count only production and preserve legacy defaults', () => {
  const legacy = { id: 'small', createdAt: '', expiresAt: 0, status: 'running', size: 'small' };
  assert.equal(containerLifecycle(legacy), 'ad_hoc');
  assert.equal(monthlyCost({ computeUnits: 6 }), 86.4);
  assert.equal(productionCost({ active: true, containers: [legacy, { ...legacy, id: 'c1', lifecycle: 'production' }],
    sizes: [{ id: 'small', name: 'Small', cpuVcpu: 0.5, diskGB: 8, computeUnits: 6, memoryMiB: 4096 }],
    limits: { maxContainers: 100, maxStartsPerMonth: 10000, maxSessionMs: 0, idleTimeoutMs: 0 },
    usage: { starts: 2, computeUnitHours: 0, reservedComputeUnitHours: 0 } }), 0.12);
});
