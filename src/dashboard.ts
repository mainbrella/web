import { API_ORIGIN, createAuthClient } from './auth.ts';
import { dashboardView, containerLifecycle, productionCost } from './dashboard-view.ts';
import type { User, PrepaidBalance, ContainerData } from './types.ts';
import { formatBalance, readPrepaidBalance } from './prepaid-billing.ts';
import { createImagesDashboard } from './images-dashboard.ts';
import { createContainersDashboard } from './containers-dashboard.ts';
import { createBuildDashboard } from './build-dashboard.ts';
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
let fundingVersion = 0;
let currentUser: User | null = null;
let lastContainerBilling: ContainerData['billing'] = null;
let dashboardTracked = false;
const view = dashboardView(location.search);
main.setAttribute('data-view', view);
document.querySelector<HTMLElement>('#dashboard-title')!.textContent = view === 'overview' ? 'Overview' : view === 'build' ? 'Build' : view === 'production' ? 'Production' : 'Ad Hoc';
document.querySelector<HTMLElement>('#dashboard-overview')!.hidden = view !== 'overview';
document.querySelector<HTMLElement>('#dashboard-build')!.hidden = view !== 'build';
const build = view === 'build' ? createBuildDashboard({ onUnauthenticated: goToLogin }) : null;
for (const link of document.querySelectorAll<HTMLAnchorElement>('.app-navigation a')) {
  if (new URL(link.href).pathname !== '/dashboard/') continue;
  if (dashboardView(new URL(link.href).search) === view) link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
}
const containers = view === 'build' ? null : createContainersDashboard({ onUnauthenticated: goToLogin,
  lifecycle: view === 'production' ? 'production' : 'ad_hoc', overview: view === 'overview',
  onLoadError() {
    document.querySelector<HTMLElement>('#overview-error')!.textContent = 'Could not load usage and workloads. Try again.';
    document.querySelector<HTMLElement>('#overview-error')!.hidden = false;
    document.querySelector<HTMLButtonElement>('#overview-retry')!.hidden = false;
  },
  onData(data) {
    document.querySelector<HTMLElement>('#overview-error')!.hidden = true;
    document.querySelector<HTMLButtonElement>('#overview-retry')!.hidden = true;
    const production = data.containers.filter(container => containerLifecycle(container) === 'production').length;
    const adHoc = data.containers.length - production;
    document.querySelector<HTMLElement>('#overview-ad-hoc')!.textContent = `${adHoc} ${adHoc === 1 ? 'container' : 'containers'}`;
    document.querySelector<HTMLElement>('#overview-production')!.textContent = `${production} ${production === 1 ? 'container' : 'containers'} · $${productionCost(data).toFixed(2)}/hour`;
    const cap = document.querySelector<HTMLElement>('#overview-production-cap')!;
    cap.hidden = !production || !data.billing;
    cap.textContent = `Production stops when its funded runtime or your ${formatBalance(data.billing?.spendLimitCents ?? 500)} monthly spending cap runs out.`;
    if (currentUser && data.billing !== lastContainerBilling && typeof data.billing?.balanceCents === 'number') {
      try {
        const balance = readPrepaidBalance(data.billing);
        lastContainerBilling = data.billing;
        fundingVersion++;
        renderFunding(balance);
        window.dispatchEvent(new CustomEvent('billing-balance-change', { detail: { userId: currentUser.id, balance } }));
      } catch { /* Keep the last verified funding status if the container response is incomplete. */ }
    }
  },
});
if (view === 'build') document.querySelector<HTMLElement>('#dashboard-resources')!.hidden = true;

document.querySelector<HTMLButtonElement>('#overview-retry')!.addEventListener('click', () => containers?.load());

const images = containers ? createImagesDashboard({ onUnauthenticated: goToLogin,
  onImagesChanged: containers.setImages, onSelectImage: containers.selectImage }) : null;

function goToLogin() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function renderFunding(balance: PrepaidBalance) {
  level.textContent = `Prepaid balance ${formatBalance(balance.balanceCents)}`;
  billing.href = '/pricing/';
  billing.textContent = balance.balanceCents <= 0 ? 'Add balance' : 'Balance and billing';
  billing.className = balance.balanceCents <= 0 ? 'button button-small' : 'text-link';
  note.hidden = balance.balanceCents > 0;
  if (!note.hidden) note.textContent = 'Add $5 or more to fund your next container. Unused funds carry forward.';
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
  billing.textContent = 'Balance and billing';
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
    currentUser = session.user;
    if (!dashboardTracked) { trackFunnel('dashboard_view'); dashboardTracked = true; }
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
    content.hidden = false;
    status.hidden = true;
    containers?.load();
    images?.load();
    build?.load(session.user.id);
    const fundingReadVersion = fundingVersion;
    const response = await fetch(`${API_ORIGIN}/billing/balance`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (currentVersion !== version) return;
    if (response.status === 401) {
      content.hidden = true;
      goToLogin();
      return;
    }
    const data = await response.json().catch(() => null);
    if (currentVersion !== version) return;
    if (fundingReadVersion !== fundingVersion) return;
    if (!response.ok) throw new Error('balance_unavailable');
    const balance = readPrepaidBalance(data.balance);
    renderFunding(balance);
    window.dispatchEvent(new CustomEvent('billing-balance-change', { detail: { userId: session.user.id, balance } }));
  } catch {
    if (currentVersion !== version) return;
    status.hidden = true;
    if (authenticated) level.textContent = 'Unavailable';
    error.textContent = authenticated
      ? 'Could not load your prepaid balance. Please try again.'
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
  if (event.detail?.user) {
    if (currentUser && event.detail.user.id !== currentUser.id) {
      version++;
      currentUser = null;
      containers?.dispose();
      images?.dispose();
      build?.dispose();
      content.hidden = true;
      window.location.reload();
    }
    return;
  }
  currentUser = null;
  version++;
  containers?.dispose();
  images?.dispose();
  build?.dispose();
  content.hidden = true;
  goToLogin();
});
loadDashboard();
