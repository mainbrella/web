import { API_ORIGIN, createAuthClient } from './auth.ts';
import { plans } from './plans.ts';
import { createImagesDashboard } from './images-dashboard.ts';
import { createContainersDashboard } from './containers-dashboard.ts';
import { trackFunnel } from './acquisition-analytics.ts';

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#dashboard-status')!;
const error = document.querySelector<HTMLElement>('#dashboard-error')!;
const retry = document.querySelector<HTMLButtonElement>('#dashboard-retry')!;
const content = document.querySelector<HTMLElement>('#dashboard-content')!;
const level = document.querySelector<HTMLElement>('#subscription-level')!;
const note = document.querySelector<HTMLElement>('#subscription-note')!;
const billing = document.querySelector<HTMLAnchorElement>('#subscription-manage')!;
let version = 0;
let dashboardTracked = false;
const containers = createContainersDashboard({ onUnauthenticated: goToLogin });

const images = createImagesDashboard({ onUnauthenticated: goToLogin,
  onImagesChanged: containers.setImages, onSelectImage: containers.selectImage });

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
  billing.href = '/pricing/';
  billing.textContent = 'Plans and billing';
  billing.className = 'text-link';
  let authenticated = false;
  try {
    const session = await auth.readSession();
    if (currentVersion !== version) return;
    if (!session?.user) {
      goToLogin();
      return;
    }
    authenticated = true;
    if (!dashboardTracked) { trackFunnel('dashboard_view'); dashboardTracked = true; }
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
    content.hidden = false;
    status.hidden = true;
    containers.load();
    images.load();
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
    level.textContent = data.active ? plans[data.plan].name : 'No active subscription';
    if (data.subscription && Object.hasOwn(plans, data.plan)) {
      billing.href = `/pricing/${data.plan}`;
      billing.textContent = 'Manage subscription';
    } else if (!data.active && !data.subscription) {
      billing.href = '/pricing/usage';
      billing.textContent = 'Start usage billing — $5 monthly minimum';
      billing.className = 'button button-small';
    } else {
      billing.textContent = 'View plans';
    }
    if (!data.active && !data.subscription) {
      note.textContent = 'Images and container creation require an active subscription. Start usage billing to choose an image and launch your first container.';
      note.hidden = false;
    } else if (data.subscription && !data.active) {
      note.textContent = 'Your subscription is inactive. Manage subscription to review billing.';
      note.hidden = false;
    } else if (data.active && data.scheduled_plan) {
      const date = data.scheduled_change_at
        ? new Date(data.scheduled_change_at * 1000).toLocaleDateString()
        : 'your next renewal';
      note.textContent = `Your plan changes to ${plans[data.scheduled_plan]?.name || data.scheduled_plan} on ${date}.`;
      note.hidden = false;
    } else if (data.active && (data.subscription?.cancel_at_period_end || data.cancel_at_period_end)) {
      note.textContent = data.valid_until
        ? `Your subscription ends on ${new Date(data.valid_until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
        : 'Your subscription ends after the current billing period.';
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
  containers.dispose();
  images.dispose();
  content.hidden = true;
  goToLogin();
});
loadDashboard();
