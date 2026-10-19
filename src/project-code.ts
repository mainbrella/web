import { initializeProjectCode } from './project-code-view.ts';
import { API_ORIGIN, createAuthClient } from './auth.ts';

const code = initializeProjectCode({
  apiOrigin: API_ORIGIN,
  readSession: () => createAuthClient().readSession(),
  onUser: user => window.dispatchEvent(new CustomEvent('auth-change', { detail: { user } })),
});
window.addEventListener('auth-change', event => code.onAuthChange(event.detail.user));
