import test from 'node:test';
import assert from 'node:assert/strict';

const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { canCreateContainer, imageSelection, productionLaunchFunding } = await import('./containers-dashboard.ts');
if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
else Reflect.deleteProperty(globalThis, "location");

const data = <T extends object>(overrides: T = {} as T) => ({
  active: true,
  limits: { maxContainers: 5, maxStartsPerMonth: 10 },
  usage: { starts: 0 },
  containers: [],
  ...overrides,
});

test('unfunded users can attempt creation and receive an authoritative funding response', () => {
  assert.equal(canCreateContainer(data({
    active: false,
    limits: { maxContainers: 0, maxStartsPerMonth: 0 },
  })), true);
});

test('prepaid creation is checked by the server when rounded available runtime is zero', () => {
  const funded = data({ billing: { balanceCents: 0 }, usage: { starts: 0, availableComputeUnitHours: 0 } });
  assert.equal(canCreateContainer(funded), true);
  assert.equal(canCreateContainer({ ...funded, containers: Array(5).fill({}) }), false);
});

test('production funding estimate includes the desired fleet and the selected machine for 24 hours', () => {
  const fleet = { active: true, plan: 'usage', containers: [],
    usage: { starts: 0, computeUnitHours: 0, reservedComputeUnitHours: 0 },
    limits: { maxContainers: 100, maxStartsPerMonth: 10000, maxSessionMs: 86400000, idleTimeoutMs: 1800000 },
    billing: { periodStart: 1, periodEnd: 2, computeUnitHours: 0, estimatedCents: 0,
      minimumCents: 0, spendLimitCents: 500, committedCents: 0, alert: null, overagesEnabled: false,
      invoicingPending: false, productionHourlyCents: 108, minimumProductionRuntimeMs: 86400000 } } as const;
  assert.equal(productionLaunchFunding({ ...fleet, containers: [] }, { computeUnits: 6 }), 2880);
  assert.equal(productionLaunchFunding({ ...fleet, containers: [], billing: { ...fleet.billing, productionHourlyCents: 0 } }, { computeUnits: 1 }), 48);
});

test('paid users can create only while below both the concurrency and monthly-start limits', () => {
  assert.equal(canCreateContainer(data()), true);
  assert.equal(canCreateContainer(data({ containers: Array(5).fill({}) })), false);
  assert.equal(canCreateContainer(data({ usage: { starts: 10 } })), false);
});

test('image selection sends a catalog ID or owned custom ID, and keeps the default body empty', () => {
  assert.deepEqual(imageSelection('catalog:python'), { catalogId: 'python' });
  assert.deepEqual(imageSelection('12345678-1234-1234-1234-123456789abc'), { imageId: '12345678-1234-1234-1234-123456789abc' });
  assert.equal(imageSelection(''), null);
});

test('selected size must fit both the monthly available runtime and weighted concurrency', () => {
  const sized = data({ limits: { maxContainers: 5, maxStartsPerMonth: 1000, maxConcurrentComputeUnits: 28 },
    usage: { starts: 1, availableComputeUnitHours: 20, concurrentComputeUnits: 6 },
    sizes: [{ id: 'lite', computeUnits: 1 }, { id: 'xl', computeUnits: 28 }] });
  assert.equal(canCreateContainer(sized, 'lite'), true);
  assert.equal(canCreateContainer(sized, 'xl'), false);
  assert.equal(canCreateContainer({ ...sized, usage: { ...sized.usage, availableComputeUnitHours: 0 } }, 'lite'), false);
});
