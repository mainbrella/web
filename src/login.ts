import type { User } from './types.ts';
import './cookie-consent.ts';
import { needsSignInCookies, signInCookieMessage } from './cookie-preferences.ts';
import { createAuthClient, GOOGLE_CLIENT_ID } from './auth.ts';

const auth = createAuthClient();
const page = document.querySelector<HTMLElement>('.login-content')!;
const status = document.querySelector<HTMLElement>('.login-status')!;
const error = document.querySelector<HTMLElement>('.login-error')!;
const provider = document.querySelector<HTMLElement>('.login-provider')!;
const googleHost = document.querySelector<HTMLElement>('.google-button-host')!;
const googleLoading = document.querySelector<HTMLElement>('.google-loading')!;
const googleRetry = document.querySelector<HTMLButtonElement>('.google-retry')!;
const signedIn = document.querySelector<HTMLElement>('.login-signed-in')!;
const identity = document.querySelector<HTMLElement>('.login-identity')!;
const signOutButton = document.querySelector<HTMLButtonElement>('.login-sign-out')!;
const profileEmail = document.querySelector<HTMLElement>('.profile-email')!;
const emailForm = document.querySelector<HTMLFormElement>('.email-login-form')!;
const emailInput = document.querySelector<HTMLInputElement>('#login-email')!;
const passwordInput = document.querySelector<HTMLInputElement>('#login-password')!;
const emailSubmit = document.querySelector<HTMLButtonElement>('.email-login-submit')!;
const cookieNotice = document.querySelector<HTMLElement>('.login-cookie-notice')!;
const signInPrompt = 'Continue with Google or email and password.';

let user: User | null = null;
let signingIn = false;
let signingOut = false;
const params = new URLSearchParams(window.location.search);
const requestedReturn = params.get('returnTo');
const returnTo = safeReturnTo(requestedReturn)
  || (/^\/login\/?$/.test(window.location.pathname) ? '/dashboard/' : null);

function safeReturnTo(value: string | null) {
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
  if (showCookieNotice()) return;
  page.setAttribute('aria-busy', 'true');
  status.textContent = 'Checking your session…';
  try {
    const session = await auth.readSession();
    user = session?.user || null;
    await showCurrentState();
  } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
    showError(cause);
    if (showCookieNotice()) return;
    provider.hidden = false;
    status.textContent = 'Could not check your session.';
    loadGoogleButton();
  } finally {
    page.setAttribute('aria-busy', 'false');
  }
}

async function showCurrentState() {
  if (showCookieNotice()) return;
  clearError();
  window.dispatchEvent(new CustomEvent('auth-change', { detail: { user } }));
  signedIn.hidden = !user;
  provider.hidden = Boolean(user);
  status.textContent = user ? 'You’re signed in.' : signInPrompt;
  if (user) {
    identity.textContent = user.name || user.email || 'Mainbrella account';
    if (profileEmail) profileEmail.textContent = user.email || 'Not provided';
    if (returnTo) window.location.replace(returnTo);
  } else {
    loadGoogleButton();
  }
}

async function loadGoogleButton() {
  if (showCookieNotice()) return;
  googleHost.replaceChildren();
  googleRetry.hidden = true;
  googleLoading.hidden = false;
  googleLoading.textContent = 'Loading Google sign-in…';
  googleHost.setAttribute('aria-busy', 'true');
  try {
    await loadGoogleIdentityScript();
    if (showCookieNotice()) return;
    if (!window.google?.accounts?.id) throw new Error('Google sign-in is unavailable. Please retry.');
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response?.credential),
      context: 'signin',
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(googleHost, {
      type: 'standard',
      theme: 'outline_dark',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(360, googleHost.clientWidth || 360),
    });
    googleLoading.hidden = true;
  } catch {
    googleLoading.hidden = false;
    googleRetry.hidden = false;
    googleLoading.textContent = 'Google sign-in could not load. You can use email below or retry Google.';
  } finally {
    googleHost.setAttribute('aria-busy', 'false');
  }
}

async function handleCredential(credential?: string) {
  await signIn(() => auth.signInWithGoogle(credential));
}

emailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!emailForm.reportValidity()) return;
  await signIn(() => auth.signInWithEmail(emailInput.value, passwordInput.value));
});

async function signIn(authenticate: () => Promise<{ user: User }>) {
  if (showCookieNotice() || signingIn || signingOut || user) return;
  signingIn = true;
  clearError();
  status.textContent = 'Signing in…';
  page.setAttribute('aria-busy', 'true');
  provider.classList.add('is-disabled');
  for (const control of [emailInput, passwordInput, emailSubmit]) {
    if (control) control.disabled = true;
  }
  if (emailSubmit) emailSubmit.textContent = 'Continuing…';
  try {
    const session = await authenticate();
    user = session.user;
    if (passwordInput) passwordInput.value = '';
    await showCurrentState();
  } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
    status.textContent = signInPrompt;
    showError(cause);
  } finally {
    signingIn = false;
    page.setAttribute('aria-busy', 'false');
    provider.classList.remove('is-disabled');
    for (const control of [emailInput, passwordInput, emailSubmit]) {
      if (control) control.disabled = false;
    }
    if (emailSubmit) emailSubmit.textContent = 'Continue with email';
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
  } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
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

function showCookieNotice() {
  const blocked = needsSignInCookies();
  cookieNotice.hidden = !blocked;
  if (blocked) {
    provider.hidden = true;
    signedIn.hidden = true;
    status.textContent = signInCookieMessage;
    clearError();
    page.setAttribute('aria-busy', 'false');
  }
  return blocked;
}

window.addEventListener('cookie-consent-change', async () => {
  await start();
  if (!provider.hidden) emailInput?.focus();
});

function showError(cause: unknown) {
  error.textContent = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
  error.hidden = false;
}

function clearError() {
  error.textContent = '';
  error.hidden = true;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity]')!;
  const script = existingScript || document.createElement('script');
  if (!existingScript) {
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
  }

  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (failure?: Error) => {
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
