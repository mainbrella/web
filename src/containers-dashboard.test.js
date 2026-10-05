import test from 'node:test';
import assert from 'node:assert/strict';

const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { canCreateContainer, imageSelection } = await import('./containers-dashboard.js');
if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
else delete globalThis.location;

const data = (overrides = {}) => ({
  active: true,
  limits: { maxContainers: 5, maxStartsPerMonth: 10 },
  usage: { starts: 0 },
  containers: [],
  ...overrides,
});

test('unpaid users can attempt creation and receive the subscription-required response', () => {
  assert.equal(canCreateContainer(data({
    active: false,
    limits: { maxContainers: 0, maxStartsPerMonth: 0 },
  })), true);
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
