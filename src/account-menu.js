import { createAuthClient } from './auth.js';

const auth = createAuthClient();
const nav = document.querySelector('.site-header nav');
const login = nav?.querySelector('.login-link');

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
      <a href="/#pricing">Billing</a>
      <button class="account-sign-out" type="button">Sign out</button>
      <p class="account-error" role="alert" hidden></p>
    </div>`;
  nav.appendChild(account);
  const toggle = account.querySelector('.account-toggle');
  const panel = account.querySelector('.account-panel');
  const identity = account.querySelector('.account-identity');
  const signOut = account.querySelector('.account-sign-out');
  const error = account.querySelector('.account-error');

  function setOpen(open, restoreFocus = false) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) toggle.focus();
  }

  function render(user) {
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
    }
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    panel.querySelector('a').focus();
  });
  account.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  document.addEventListener('click', (event) => {
    if (!account.contains(event.target)) setOpen(false);
  });
  account.addEventListener('focusout', (event) => {
    if (!account.contains(event.relatedTarget)) setOpen(false);
  });
  panel.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  signOut.addEventListener('click', async () => {
    if (signOut.disabled) return;
    toggle.focus();
    signOut.disabled = true;
    signOut.textContent = 'Signing out…';
    error.hidden = true;
    try {
      await auth.signOut();
      (login || nav.querySelector('a'))?.focus();
    } catch (cause) {
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
  refresh();
}
