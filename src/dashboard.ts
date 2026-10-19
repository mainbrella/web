import './linux.ts';
import { dashboardView } from './dashboard-view.ts';
import type { ContainerData } from './types.ts';
import { readPrepaidBalance } from './prepaid-billing.ts';
import { createOverviewFeed } from './overview-feed.ts';
import { createImagesDashboard } from './linux-view.ts';
import { createContainersDashboard } from './linux-view.ts';
import { initializeAccountPage } from './account-page.ts';
import { legacyBuildURL } from './build-route.ts';

const buildURL = legacyBuildURL(location.search, location.hash);
if (buildURL) window.location.replace(buildURL);
else initializeDashboard();

function initializeDashboard() {
  let lastContainerBilling: ContainerData['billing'] = null;
  const view = dashboardView(location.search);
  document.querySelector<HTMLElement>('#dashboard-overview')!.hidden = view !== 'overview';
  document.querySelector<HTMLElement>('#dashboard-resources')!.hidden = view === 'overview';
  const overview = view === 'overview' ? createOverviewFeed({ onUnauthenticated: goToLogin,
    onBalance(balance) { account.updateBalance(balance); },
  }) : null;
  const containers = view !== 'overview' ? createContainersDashboard({ onUnauthenticated: goToLogin,
    getAccountId: () => account.user?.id ?? null,
    lifecycle: view === 'production' ? 'production' : 'ad_hoc',
    onData(data) {
      if (account.user && data.billing !== lastContainerBilling && typeof data.billing?.balanceCents === 'number') {
        try {
          const balance = readPrepaidBalance(data.billing);
          lastContainerBilling = data.billing;
          account.updateBalance(balance);
        } catch { /* Keep the last verified funding status if the container response is incomplete. */ }
      }
    },
  }) : null;
  const images = containers ? createImagesDashboard({ onUnauthenticated: goToLogin,
    onImagesChanged: containers.setImages, onSelectImage: containers.selectImage }) : null;

  function goToLogin() {
    window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }

  const account = initializeAccountPage({
    load() { overview?.load(); containers?.load(); images?.load(); },
    dispose() { overview?.dispose(); containers?.dispose(); images?.dispose(); },
  });
}
