import { API_ORIGIN, createAuthClient } from './auth.js';
import { plans } from './plans.js';

const auth = createAuthClient();
const main = document.querySelector('#main');
const status = document.querySelector('#dashboard-status');
const error = document.querySelector('#dashboard-error');
const retry = document.querySelector('#dashboard-retry');
const content = document.querySelector('#dashboard-content');
const level = document.querySelector('#subscription-level');
const note = document.querySelector('#subscription-note');
let version = 0;

function goToLogin() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

async function loadDashboard() {
  const currentVersion = ++version;
  main.setAttribute('aria-busy', 'true');
  error.hidden = true;
  retry.hidden = true;
  retry.disabled = true;
  status.hidden = false;
  status.textContent = 'Checking your session…';
  level.textContent = 'Loading…';
  note.hidden = true;
  let authenticated = false;
  try {
    const session = await auth.readSession();
    if (currentVersion !== version) return;
    if (!session?.user) {
      goToLogin();
      return;
    }
    authenticated = true;
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
    content.hidden = false;
    status.hidden = true;
    const response = await fetch(`${API_ORIGIN}/subscription`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (currentVersion !== version) return;
    if (response.status === 401) {
      content.hidden = true;
      goToLogin();
      return;
    }
    const data = await response.json();
    if (currentVersion !== version) return;
    if (!response.ok || typeof data?.active !== 'boolean'
      || (data.active && !Object.hasOwn(plans, data.plan))) {
      throw new Error('subscription_unavailable');
    }
    level.textContent = data.active ? plans[data.plan].name : 'None';
    if (data.subscription && !data.active) {
      note.textContent = 'Your subscription is inactive. Manage subscription to review billing.';
      note.hidden = false;
    } else if (data.active && data.subscription?.cancel_at_period_end) {
      note.textContent = 'Your subscription ends after the current billing period.';
      note.hidden = false;
    }
  } catch {
    if (currentVersion !== version) return;
    status.hidden = true;
    if (authenticated) level.textContent = 'Unavailable';
    error.textContent = authenticated
      ? 'Could not load your subscription. Please try again.'
      : 'Could not check your session. Check your connection and try again.';
    error.hidden = false;
    retry.hidden = false;
  } finally {
    if (currentVersion === version) {
      main.setAttribute('aria-busy', 'false');
      retry.disabled = false;
    }
  }
}

retry.addEventListener('click', loadDashboard);
window.addEventListener('auth-change', (event) => {
  if (event.detail?.user !== null) return;
  version++;
  content.hidden = true;
  goToLogin();
});
loadDashboard();
