import { createAuthClient, GOOGLE_CLIENT_ID } from './auth.js';

const auth = createAuthClient();
const page = document.querySelector('.login-content');
const status = document.querySelector('.login-status');
const error = document.querySelector('.login-error');
const provider = document.querySelector('.login-provider');
const googleHost = document.querySelector('.google-button-host');
const googleLoading = document.querySelector('.google-loading');
const googleRetry = document.querySelector('.google-retry');
const signedIn = document.querySelector('.login-signed-in');
const identity = document.querySelector('.login-identity');
const signOutButton = document.querySelector('.login-sign-out');
const profileEmail = document.querySelector('.profile-email');

let user = null;
let signingIn = false;
let signingOut = false;
const params = new URLSearchParams(window.location.search);
const requestedReturn = params.get('returnTo');
const returnTo = safeReturnTo(requestedReturn)
  || (/^\/login\/?$/.test(window.location.pathname) ? '/dashboard/' : null);

function safeReturnTo(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || /^\/login(?:\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

start();

async function start() {
  page.setAttribute('aria-busy', 'true');
  status.textContent = 'Checking your session…';
  try {
    const session = await auth.readSession();
    user = session?.user || null;
    await showCurrentState();
  } catch (cause) {
    showError(cause);
    provider.hidden = false;
    status.textContent = 'Could not check your session.';
    loadGoogleButton();
  } finally {
    page.setAttribute('aria-busy', 'false');
  }
}

async function showCurrentState() {
  clearError();
  window.dispatchEvent(new CustomEvent('auth-change', { detail: { user } }));
  signedIn.hidden = !user;
  provider.hidden = Boolean(user);
  status.textContent = user ? 'You’re signed in.' : 'Use your Google account to continue.';
  if (user) {
    identity.textContent = user.name || user.email || 'Google account';
    if (profileEmail) profileEmail.textContent = user.email || 'Not provided';
    if (returnTo) window.location.replace(returnTo);
  } else {
    loadGoogleButton();
  }
}

async function loadGoogleButton() {
  googleHost.replaceChildren();
  googleRetry.hidden = true;
  googleLoading.hidden = false;
  provider.setAttribute('aria-busy', 'true');
  try {
    await loadGoogleIdentityScript();
    if (!window.google?.accounts?.id) throw new Error('Google sign-in is unavailable. Please retry.');
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response?.credential),
      context: 'signin',
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(googleHost, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(360, googleHost.clientWidth || 360),
    });
    googleLoading.hidden = true;
  } catch {
    googleLoading.hidden = true;
    googleRetry.hidden = false;
    showError(new Error('Google sign-in could not load. Check your connection and retry.'));
  } finally {
    provider.setAttribute('aria-busy', 'false');
  }
}

async function handleCredential(credential) {
  if (signingIn || signingOut || user) return;
  signingIn = true;
  clearError();
  status.textContent = 'Signing in…';
  page.setAttribute('aria-busy', 'true');
  provider.classList.add('is-disabled');
  try {
    const session = await auth.signInWithGoogle(credential);
    user = session.user;
    await showCurrentState();
  } catch (cause) {
    status.textContent = 'Use your Google account to continue.';
    showError(cause);
  } finally {
    signingIn = false;
    page.setAttribute('aria-busy', 'false');
    provider.classList.remove('is-disabled');
  }
}

signOutButton.addEventListener('click', async () => {
  if (signingOut || signingIn || !user) return;
  signingOut = true;
  signOutButton.disabled = true;
  page.setAttribute('aria-busy', 'true');
  status.textContent = 'Signing out…';
  clearError();
  try {
    await auth.signOut();
    user = null;
    await showCurrentState();
  } catch (cause) {
    status.textContent = 'You’re still signed in.';
    showError(cause);
  } finally {
    signingOut = false;
    signOutButton.disabled = false;
    page.setAttribute('aria-busy', 'false');
  }
});

googleRetry.addEventListener('click', () => {
  clearError();
  loadGoogleButton();
});

window.addEventListener('auth-change', (event) => {
  if (event.detail?.user !== null || !user) return;
  user = null;
  showCurrentState();
});

function showError(cause) {
  error.textContent = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
  error.hidden = false;
}

function clearError() {
  error.textContent = '';
  error.hidden = true;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existingScript = document.querySelector('script[data-google-identity]');
  const script = existingScript || document.createElement('script');
  if (!existingScript) {
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
  }

  return new Promise((resolve, reject) => {
    let timeout;
    const finish = (failure) => {
      clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (failure) {
        script.remove();
        reject(failure);
      } else resolve();
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error('Google sign-in could not load.'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timeout = setTimeout(() => finish(new Error('Google sign-in took too long to load.')), 12000);
    if (!existingScript) document.head.appendChild(script);
  });
}
