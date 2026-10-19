import { isDemoSession, type DemoSession } from './api.ts';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): SessionStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

export function readStoredSession(key: string, storage = browserStorage()): DemoSession | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
    if (isDemoSession(value) && Date.parse(value.session.expires_at) > Date.now()) return value;
    storage?.removeItem(key);
  } catch {
    writeStoredSession(key, null, storage);
  }
  return null;
}

export function writeStoredSession(key: string, session: DemoSession | null, storage = browserStorage()): void {
  try {
    if (session) storage?.setItem(key, JSON.stringify(session));
    else storage?.removeItem(key);
  } catch {
    // Storage can be disabled; the current page can still use its in-memory session.
  }
}
