import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSession, writeStoredSession } from './session.ts';
import type { DemoSession } from './api.ts';

const session: DemoSession = { token: `bff_us_${'a'.repeat(64)}`, session: {
  id: 'alice-session', user_id: 'alice', created_at: '2026-10-18T00:00:00Z', expires_at: '2099-01-01T00:00:00Z',
} };

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}

test('sessions survive page initialization, stay scoped to their project, and are removed on logout', () => {
  const storage = memoryStorage();
  writeStoredSession('live', session, storage);
  assert.deepEqual(readStoredSession('live', storage), session);
  assert.equal(readStoredSession('local', storage), null);
  writeStoredSession('live', null, storage);
  assert.equal(readStoredSession('live', storage), null);
  assert.equal(storage.getItem('live'), null);
});

test('expired, malformed and invalid stored sessions are discarded', () => {
  const storage = memoryStorage();
  for (const value of ['{broken', '{}', JSON.stringify({ ...session, token: 'invalid' }),
    JSON.stringify({ ...session, session: { ...session.session, expires_at: '2000-01-01T00:00:00Z' } })]) {
    storage.setItem('demo', value);
    assert.equal(readStoredSession('demo', storage), null);
    assert.equal(storage.getItem('demo'), null);
  }
});

test('disabled storage does not prevent login or logout', () => {
  const fail = () => { throw new Error('Storage unavailable'); };
  const storage = { getItem: fail, setItem: fail, removeItem: fail };
  assert.equal(readStoredSession('demo', storage), null);
  assert.doesNotThrow(() => writeStoredSession('demo', session, storage));
  assert.doesNotThrow(() => writeStoredSession('demo', null, storage));
});
