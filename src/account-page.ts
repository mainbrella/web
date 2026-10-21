import { API_ORIGIN, createAuthClient } from './auth.ts';
import type { User, PrepaidBalance } from './types.ts';
import { formatBalance, readPrepaidBalance } from './prepaid-billing.ts';

// Both independently built apps use the same session and funding lifecycle.
export function initializeAccountPage({ load, dispose }: { load: (user: User) => void; dispose: () => void }) {
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

  function updateBalance(balance: PrepaidBalance) {
    if (!currentUser) return;
    fundingVersion++;
    renderFunding(balance);
    window.dispatchEvent(new CustomEvent('billing-balance-change', { detail: { userId: currentUser.id, balance } }));
  }

  async function loadPage() {
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
      if (!session?.user) { goToLogin(); return; }
      authenticated = true;
      currentUser = session.user;
      window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
      content.hidden = false;
      status.hidden = true;
      load(session.user);
      const fundingReadVersion = fundingVersion;
      const response = await fetch(`${API_ORIGIN}/billing/balance`, {
        credentials: 'include', headers: { accept: 'application/json' },
      });
      if (currentVersion !== version) return;
      if (response.status === 401) { content.hidden = true; dispose(); goToLogin(); return; }
      const data = await response.json().catch(() => null);
      if (currentVersion !== version || fundingReadVersion !== fundingVersion) return;
      if (!response.ok) throw new Error('balance_unavailable');
      updateBalance(readPrepaidBalance(data.balance));
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
      if (currentVersion === version) { main.setAttribute('aria-busy', 'false'); retry.disabled = false; }
    }
  }

  retry.addEventListener('click', loadPage);
  window.addEventListener('auth-change', event => {
    if (event.detail?.user) {
      if (currentUser && event.detail.user.id !== currentUser.id) {
        version++;
        currentUser = null;
        dispose();
        content.hidden = true;
        window.location.reload();
      }
      return;
    }
    currentUser = null;
    version++;
    dispose();
    content.hidden = true;
    goToLogin();
  });
  void loadPage();
  return { updateBalance, get user() { return currentUser; } };
}
