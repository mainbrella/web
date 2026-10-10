import test from 'node:test';
import assert from 'node:assert/strict';
import type { BuildModel } from './build-api.ts';

const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { selectBuildModelOptions } = await import('./build-dashboard.ts');
if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
else Reflect.deleteProperty(globalThis, 'location');

const models: BuildModel[] = [
  { id: 'quality', name: 'Quality', efforts: ['high', 'max'], defaultEffort: 'high' },
  { id: 'coding', name: 'Coding', efforts: ['always'], defaultEffort: 'always' },
  { id: 'economy', name: 'Economy', efforts: ['high', 'max'], defaultEffort: 'high' },
];

test('new builds use the configured model and its recommended effort', () => {
  assert.deepEqual(selectBuildModelOptions(models, 'quality', {}), { model: 'quality', effort: 'high' });
  assert.deepEqual(selectBuildModelOptions(models, 'economy', {}), { model: 'economy', effort: 'high' });
  assert.deepEqual(selectBuildModelOptions(models, 'coding', {}), { model: 'coding', effort: 'always' });
});

test('remembered supported choices survive reloads and app selection', () => {
  const options = { model: 'economy', effort: 'max' };
  assert.deepEqual(selectBuildModelOptions(models, 'quality', options), options);
  assert.deepEqual(selectBuildModelOptions(models, 'quality', { model: 'coding', effort: 'high' }), { model: 'coding', effort: 'always' });
});

test('pruned preferences and historical turns reset to recommended choices', () => {
  assert.deepEqual(selectBuildModelOptions(models, 'quality', { model: 'economy', effort: 'low' }), { model: 'economy', effort: 'high' });
  assert.deepEqual(selectBuildModelOptions(models, 'quality', { model: 'removed', effort: 'max' }), { model: 'quality', effort: 'high' });
  assert.deepEqual(selectBuildModelOptions(models, 'quality', { effort: 'max' }), { model: 'quality', effort: 'high' });
});

test('missing config and unavailable defaults have a safe fallback', () => {
  assert.deepEqual(selectBuildModelOptions([], undefined, { model: 'quality', effort: 'max' }), {});
  assert.deepEqual(selectBuildModelOptions(models, 'removed', {}), { model: 'quality', effort: 'high' });
});
