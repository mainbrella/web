import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildDraftStore, formatBuildBrief, maxBuildDrafts, newBuildDraft } from './build-drafts.ts';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('drafts persist per account and include the full initial brief', () => {
  const browser = storage();
  const owner = createBuildDraftStore(browser, 'owner');
  const other = createBuildDraftStore(browser, 'other');
  const text = 'Build a dashboard with an overview, charts, filters, and a long description.\nMake it accessible.';
  const draft = newBuildDraft(`  ${text}  `);
  assert.ok(draft.name.length <= 64);
  assert.equal(draft.messages[0].text, text);
  owner.save([draft]);
  assert.deepEqual(owner.read(), [draft]);
  assert.deepEqual(other.read(), []);
  assert.match(formatBuildBrief(draft), /Make it accessible/);
});

test('damaged or invalid saved drafts fail without rewriting stored data', () => {
  const browser = storage();
  const store = createBuildDraftStore(browser, 'owner');
  const key = 'mainbrella-build-drafts:v1:owner';
  for (const value of ['{broken', '{}', '[null]', JSON.stringify([{ ...newBuildDraft('Build a tracker'), messages: [{ text: '', createdAt: 'invalid' }] }])]) {
    browser.setItem(key, value);
    assert.throws(() => store.read());
    assert.equal(browser.getItem(key), value);
  }
});

test('updates round trip, sort by last edit, and export with their context', () => {
  const store = createBuildDraftStore(storage(), 'owner');
  const first = newBuildDraft('Build a task board');
  const second = newBuildDraft('Build a portfolio');
  first.updatedAt = '2026-10-10T20:00:00.000Z';
  second.updatedAt = '2026-10-10T19:00:00.000Z';
  first.messages.push({ text: 'Add filters by owner', createdAt: first.updatedAt });
  store.save([second, first]);
  assert.equal(store.read()[0].id, first.id);
  assert.equal(formatBuildBrief(first), 'Build a task board\n\nInitial brief\nBuild a task board\n\nUpdate 1\nAdd filters by owner\n');
});

test('storage failures propagate and quota or duplicate IDs are rejected before writing', () => {
  const draft = newBuildDraft('Build a tracker');
  const browser = storage();
  const store = createBuildDraftStore(browser, 'owner');
  assert.throws(() => store.save([draft, draft]), /invalid_drafts/);
  assert.throws(() => store.save(Array.from({ length: maxBuildDrafts + 1 }, () => newBuildDraft('Build a tracker'))), /invalid_drafts/);
  assert.equal(browser.values.size, 0);
  const blocked = createBuildDraftStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } }, 'owner');
  assert.throws(() => blocked.read(), /blocked/);
  assert.throws(() => blocked.save([draft]), /quota/);
  assert.throws(() => newBuildDraft('   '), /invalid_prompt/);
  assert.throws(() => newBuildDraft('x'.repeat(6001)), /invalid_prompt/);
});
