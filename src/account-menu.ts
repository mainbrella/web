import type { User } from './types.ts';
import { createAuthClient } from './auth.ts';

const auth = createAuthClient();
const nav = document.querySelector<HTMLElement>('.site-header nav')!;
const login = nav?.querySelector<HTMLElement>('.login-link')!;

if (nav) {
  const account = document.createElement('div');
  account.className = 'account-menu';
  account.hidden = true;
  account.innerHTML = `
    <button class="account-toggle" type="button" aria-expanded="false" aria-controls="account-panel">
      Account <span aria-hidden="true">⌄</span>
    </button>
    <div class="account-panel" id="account-panel" hidden>
      <p class="account-identity"></p>
      <a href="/dashboard/">Dashboard</a>
      <a href="/profile/">Profile</a>
      <a href="/api-keys/">API Keys</a>
      <a href="/pricing/">Billing</a>
      <button class="account-sign-out" type="button">Sign out</button>
      <p class="account-error" role="alert" hidden></p>
    </div>`;
  nav.appendChild(account);
  const toggle = account.querySelector<HTMLElement>('.account-toggle')!;
  const panel = account.querySelector<HTMLElement>('.account-panel')!;
  const identity = account.querySelector<HTMLElement>('.account-identity')!;
  const signOut = account.querySelector<HTMLButtonElement>('.account-sign-out')!;
  const error = account.querySelector<HTMLElement>('.account-error')!;

  function setOpen(open: boolean, restoreFocus = false) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) toggle.focus();
  }

  function render(user?: User | null) {
    if (user && window.location.pathname === '/') {
      document.documentElement.setAttribute('data-home-session', 'redirecting');
      window.location.replace('/dashboard/');
      return;
    }
    document.documentElement.removeAttribute('data-home-session');
    account.hidden = !user;
    nav.classList.toggle('has-account', Boolean(user));
    if (login) login.hidden = Boolean(user);
    identity.textContent = user?.email || user?.name || 'Your account';
    if (!user) setOpen(false);
  }

  let sessionVersion = 0;
  async function refresh() {
    const version = ++sessionVersion;
    try {
      const session = await auth.readSession();
      if (version === sessionVersion) render(session?.user);
    } catch {
      // Leave navigation as it is when the session service is unavailable.
      if (version === sessionVersion) document.documentElement.removeAttribute('data-home-session');
    }
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    panel.querySelector<HTMLAnchorElement>('a')!.focus();
  });
  account.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  document.addEventListener('click', (event) => {
    if (!account.contains(event.target as Node | null)) setOpen(false);
  });
  account.addEventListener('focusout', (event) => {
    if (!account.contains(event.relatedTarget as Node | null)) setOpen(false);
  });
  panel.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  signOut.addEventListener('click', async () => {
    if (signOut.disabled) return;
    toggle.focus();
    signOut.disabled = true;
    signOut.textContent = 'Signing out…';
    error.hidden = true;
    try {
      await auth.signOut();
      (login || nav.querySelector<HTMLAnchorElement>('a')!)?.focus();
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error("Unexpected error");
      error.textContent = cause.message;
      error.hidden = false;
    } finally {
      signOut.disabled = false;
      signOut.textContent = 'Sign out';
    }
  });
  window.addEventListener('auth-change', (event) => {
    if (event.detail && 'user' in event.detail) {
      sessionVersion++;
      render(event.detail.user);
    } else refresh();
  });
  window.addEventListener('checkout-processing', (event) => {
    signOut.disabled = event.detail.processing;
  });
  window.addEventListener('cookie-consent-change', refresh);
  refresh();
}
