import { createAuthClient } from './auth.ts';

const auth = createAuthClient();

function goToLogin() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

window.addEventListener('auth-change', (event) => {
  if (event.detail?.user === null) goToLogin();
});

try {
  const session = await auth.readSession();
  if (!session?.user) {
    goToLogin();
  } else {
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
  }
} catch {
  // Keep the blank view available if the session service is temporarily unavailable.
}
