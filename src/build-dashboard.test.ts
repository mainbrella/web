import test from 'node:test';
import assert from 'node:assert/strict';
import type { BuildModel, BuildTurn } from './build-api.ts';

const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'location', { value: { hostname: 'localhost' }, configurable: true });
const { selectBuildModelOptions, buildProgressText } = await import('./build-dashboard.ts');
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

test('live progress distinguishes drafting a file from saving or running a tool', () => {
  const turn = { stage: 'Editing and checking', activity: [
    { id: 'read', type: 'tool', text: 'Read src/App.tsx', status: 'succeeded' },
    { id: 'write', type: 'tool', text: 'Drafting src/App.tsx · 124 lines', status: 'proposed' },
  ] } as BuildTurn;
  assert.equal(buildProgressText(turn), 'Drafting src/App.tsx · 124 lines');
  turn.activity![1] = { ...turn.activity![1], text: 'Write src/App.tsx', status: 'running' };
  assert.equal(buildProgressText(turn), 'Saving src/App.tsx');
  turn.activity![1].status = 'succeeded';
  assert.equal(buildProgressText(turn), 'Working on your app…');
  turn.stage = 'Starting preview';
  assert.equal(buildProgressText(turn), 'Starting preview');
});

test('live progress prioritizes executing tools and handles older servers without drafting labels', () => {
  const turn = { stage: 'Editing and checking', activity: [
    { id: 'read', type: 'tool', text: 'Read src/App.tsx', status: 'running' },
    { id: 'write', type: 'tool', text: 'Write src/style.css', status: 'proposed' },
  ] } as BuildTurn;
  assert.equal(buildProgressText(turn), 'Reading src/App.tsx');
  turn.activity![0].status = 'succeeded';
  assert.equal(buildProgressText(turn), 'Preparing to write src/style.css…');
  turn.activity![1].status = 'skipped';
  assert.equal(buildProgressText(turn), 'Working on your app…');
  assert.equal(buildProgressText(undefined), 'Connecting to Build…');
});
