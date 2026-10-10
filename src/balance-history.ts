import { API_ORIGIN, createAuthClient } from './auth.ts';
import type { User } from './types.ts';
import { formatBalance } from './prepaid-billing.ts';
import { formatRuntime, formatRuntimeCost, readBalanceHistory } from './balance-history-data.ts';
import type { BalanceFunding, BalanceHistory, BalanceResource } from './balance-history-data.ts';
import { formatStorageBytes, type StorageBilling, type StorageProject } from './storage-billing-data.ts';

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#history-status')!;
const error = document.querySelector<HTMLElement>('#history-error')!;
const retry = document.querySelector<HTMLButtonElement>('#history-retry')!;
const refresh = document.querySelector<HTMLButtonElement>('#history-refresh')!;
const content = document.querySelector<HTMLElement>('#history-content')!;
const resourceTable = document.querySelector<HTMLTableElement>('#history-resources-table')!;
const fundingTable = document.querySelector<HTMLTableElement>('#history-fundings-table')!;
const resourceRows = document.querySelector<HTMLTableSectionElement>('#history-resources')!;
const fundingRows = document.querySelector<HTMLTableSectionElement>('#history-fundings')!;
const resourcesMore = document.querySelector<HTMLButtonElement>('#history-resources-more')!;
const fundingsMore = document.querySelector<HTMLButtonElement>('#history-fundings-more')!;
const resourcesStatus = document.querySelector<HTMLElement>('#history-resources-status')!;
const fundingsStatus = document.querySelector<HTMLElement>('#history-fundings-status')!;
const resourceScroll = resourceTable.parentElement!;
const fundingScroll = fundingTable.parentElement!;

type RequestKind = 'refresh' | 'resources' | 'fundings';
const defaultMoreText: Record<'resources' | 'fundings', string> = {
  resources: 'Load more resources',
  fundings: 'Load more balance additions',
};

let currentUser: User | null = null;
let snapshot: BalanceHistory | null = null;
let authEpoch = 0;
let requestVersion = 0;
let requestController: AbortController | null = null;
let requestKind: RequestKind | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(id: string, value: string) {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = value;
}

function dateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function friendlySize(size: string) {
  return size.split(/[-_\s]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

function setLoading(kind: RequestKind | null) {
  requestKind = kind;
  const loading = kind !== null;
  main.setAttribute('aria-busy', String(loading));
  refresh.disabled = loading || !currentUser;
  refresh.textContent = kind === 'refresh' ? 'Refreshing…' : 'Refresh';
  for (const [name, button] of [['resources', resourcesMore], ['fundings', fundingsMore]] as const) {
    const active = kind === name;
    button.disabled = loading || !snapshot;
    button.textContent = active ? 'Loading…' : defaultMoreText[name];
  }
}

function clearSnapshot() {
  snapshot = null;
  content.hidden = true;
  resourceRows.replaceChildren();
  fundingRows.replaceChildren();
  document.querySelector<HTMLElement>('#history-storage-section')!.hidden = true;
  document.querySelector<HTMLElement>('#history-storage')!.replaceChildren();
  resourceTable.hidden = true;
  fundingTable.hidden = true;
  resourceScroll.hidden = true;
  fundingScroll.hidden = true;
  document.querySelector<HTMLElement>('#history-resources-empty')!.hidden = true;
  document.querySelector<HTMLElement>('#history-fundings-empty')!.hidden = true;
  resourcesMore.hidden = true;
  fundingsMore.hidden = true;
  resourcesStatus.textContent = '';
  fundingsStatus.textContent = '';
  document.querySelector<HTMLElement>('#history-unattributed')!.hidden = true;
  document.querySelector<HTMLElement>('#history-fundings-note')!.hidden = true;
  for (const id of ['history-balance', 'history-available', 'history-reserved', 'history-funded', 'history-revoked', 'history-used', 'history-reconciled']) setText(id, '—');
  setText('history-as-of', '');
  setText('history-activity', '');
  setLoading(null);
}

function invalidate(clear = true) {
  authEpoch++;
  requestVersion++;
  requestController?.abort();
  requestController = null;
  setLoading(null);
  if (clear) clearSnapshot();
}

function goToLogin() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function publishBalance(user: User, data: BalanceHistory) {
  window.dispatchEvent(new CustomEvent('billing-balance-change', {
    detail: { userId: user.id, balance: data.balance },
  }));
}

function renderSummary(data: BalanceHistory) {
  setText('history-balance', formatBalance(data.balance.balanceCents));
  setText('history-available', formatBalance(data.balance.availableBalanceCents));
  setText('history-reserved', formatBalance(data.balance.reservedBalanceCents));
  setText('history-funded', formatBalance(data.totals.fundedCents));
  setText('history-revoked', `−${formatBalance(data.totals.revokedCents)}`);
  setText('history-used', `−${formatRuntimeCost(data.totals.usedCents)}`);
  setText('history-reconciled', formatBalance(data.balance.balanceCents));
  setText('history-as-of', `Balance as of ${dateTime(data.asOf)}.`);
  const activeCount = data.activeResources.filter(resource => resource.active).length;
  setText('history-activity', activeCount > 0
    ? `${activeCount} allocated ${activeCount === 1 ? 'resource is' : 'resources are'} consuming ${formatBalance(data.currentHourlyCents)}/hour.`
    : 'No containers are currently consuming balance.');
  if (data.totals.inferenceUsedCents) {
    document.querySelector<HTMLElement>('#history-activity')!.append(` Build AI has consumed ${formatRuntimeCost(data.totals.inferenceUsedCents)}.`);
  }
  if (data.totals.storageUsedCents) document.querySelector<HTMLElement>('#history-activity')!.append(` Storage and Git have consumed ${formatRuntimeCost(data.totals.storageUsedCents)}.`);

  const unattributed = document.querySelector<HTMLElement>('#history-unattributed')!;
  const hasUnattributed = data.totals.unattributedUsedCents > 0;
  const hasTruncated = data.historyTruncated;
  unattributed.hidden = !hasUnattributed && !hasTruncated;
  if (hasUnattributed) {
    unattributed.textContent = `Earlier compute usage: ${formatRuntimeCost(data.totals.unattributedUsedCents)}. Resource details are unavailable for usage before tracking began or outside the latest ${data.retainedResourceLimit.toLocaleString('en-US')} completed allocations.`;
  } else if (hasTruncated) {
    unattributed.textContent = `Per-resource details are unavailable beyond the retained limit of ${data.retainedResourceLimit.toLocaleString('en-US')} completed allocations.`;
  } else unattributed.textContent = '';

  const fundingNote = document.querySelector<HTMLElement>('#history-fundings-note')!;
  const hasReversals = data.fundings.some(funding => funding.revokedCents > 0);
  fundingNote.hidden = !hasReversals;
  fundingNote.textContent = hasReversals
    ? 'Dates show when balance was added. Removed credit reflects the current refund or dispute total for that addition.'
    : '';
}

function resourceName(resource: BalanceResource, current: boolean) {
  const label = resource.name || resource.containerId;
  if (!current || !resource.active || !resource.name) return element('strong', 'history-resource-identity', label);
  const link = element('a', 'history-resource-identity', label);
  const view = resource.lifecycle === 'production' ? 'production' : 'ad-hoc';
  link.href = `/dashboard/?view=${view}`;
  link.setAttribute('aria-label', `View ${resource.lifecycle === 'production' ? 'production' : 'Ad Hoc'} container ${label}`);
  return link;
}

function resourceRow(resource: BalanceResource, current: boolean) {
  const row = element('tr', 'history-resource-row');
  const identity = element('td', 'history-resource');
  identity.append(resourceName(resource, current));
  if (resource.name && resource.name !== resource.containerId) {
    identity.append(element('span', 'history-resource-meta', resource.containerId));
  }
  const meta = `${friendlySize(resource.size)} · ${resource.lifecycle === 'production' ? 'Production' : 'Ad Hoc'}`;
  identity.append(element('span', 'history-resource-meta', meta));
  if (current) {
    const state = resource.active ? 'Consuming balance' : 'Awaiting confirmed stop';
    identity.append(element('span', 'history-active', state));
  } else {
    identity.append(element('span', 'history-active', 'Stopped'));
  }
  row.append(identity);

  const period = element('td', 'history-period');
  period.append(element('span', undefined, dateTime(resource.startAt)));
  const periodDetail = resource.endAt !== null
    ? `Ended ${dateTime(resource.endAt)}`
    : resource.active ? 'Ongoing' : 'Allocation ended; stop unconfirmed';
  period.append(element('span', 'history-period-detail', periodDetail));
  row.append(period);

  const runtime = element('td', 'history-number');
  runtime.append(element('span', undefined, formatRuntime(resource.runtimeMs)));
  runtime.append(element('span', 'history-period-detail', `${resource.computeUnitHours.toLocaleString('en-US', { maximumFractionDigits: 4 })} CU-hours`));
  row.append(runtime);
  row.append(element('td', 'history-number', `${formatBalance(resource.hourlyCents)}/hr`));
  row.append(element('td', 'history-number', formatRuntimeCost(resource.usedCents)));
  row.append(element('td', 'history-number', formatRuntimeCost(resource.reservedCents)));
  return row;
}

function fundingRow(funding: BalanceFunding) {
  const row = element('tr', 'history-funding-row');
  row.append(element('td', undefined, dateTime(funding.createdAt)));
  row.append(element('td', 'history-number', `+${formatBalance(funding.amountCents)}`));
  row.append(element('td', 'history-number', funding.revokedCents > 0 ? `−${formatBalance(funding.revokedCents)}` : '$0.00'));
  row.append(element('td', undefined, funding.revokedCents === 0
    ? 'No credit removed'
    : funding.reason === 'refund' ? 'Refund' : funding.reason === 'dispute' ? 'Dispute' : 'Credit removed'));
  return row;
}

function renderResources(data: BalanceHistory) {
  const resources = new Map<string, { resource: BalanceResource; current: boolean }>();
  for (const resource of data.resources) resources.set(resource.id, { resource, current: false });
  for (const resource of data.activeResources) resources.set(resource.id, { resource, current: true });
  const ordered = [...resources.values()].sort((a, b) => Number(b.resource.active) - Number(a.resource.active)
    || Number(b.current) - Number(a.current)
    || b.resource.startAt - a.resource.startAt);
  resourceRows.replaceChildren(...ordered.map(({ resource, current }) => resourceRow(resource, current)));
  const empty = document.querySelector<HTMLElement>('#history-resources-empty')!;
  empty.hidden = ordered.length > 0;
  resourceTable.hidden = ordered.length === 0;
  resourceScroll.hidden = ordered.length === 0;
  resourcesMore.hidden = data.nextResourceCursor === null;
  resourcesMore.disabled = requestKind !== null || !currentUser;
  resourcesMore.textContent = requestKind === 'resources' ? 'Loading…' : defaultMoreText.resources;
}

function renderFundings(data: BalanceHistory) {
  fundingRows.replaceChildren(...data.fundings.map(fundingRow));
  const empty = document.querySelector<HTMLElement>('#history-fundings-empty')!;
  empty.hidden = data.fundings.length > 0;
  fundingTable.hidden = data.fundings.length === 0;
  fundingScroll.hidden = data.fundings.length === 0;
  fundingsMore.hidden = data.nextFundingCursor === null;
  fundingsMore.disabled = requestKind !== null || !currentUser;
  fundingsMore.textContent = requestKind === 'fundings' ? 'Loading…' : defaultMoreText.fundings;
}

function storageRow(project: StorageProject, mode: StorageBilling['pricing']['mode']) {
  const row = element('tr', 'history-storage-row');
  const identity = element('td', 'history-storage-project', project.name ?? 'Deleted project');
  const details = element('details', 'history-storage-details');
  details.append(element('summary', undefined, 'Usage details'));
  const list = element('dl');
  for (const [label, value] of [
    ['Source, assets and diagnostics', formatStorageBytes(project.sourceAssetsBytes)], ['Git history', formatStorageBytes(project.historyBytes)],
    ['Reads / writes and listings', `${project.reads.toLocaleString('en-US')} / ${project.writes.toLocaleString('en-US')}`],
    ['Cloudflare cost (provisional)', formatRuntimeCost(project.cloudflareCents)], ['Markup (provisional)', formatRuntimeCost(project.markupCents)],
    ['Invoice adjustments', formatRuntimeCost(project.adjustmentCents)],
    ['Funded through', project.fundedThrough === null ? mode === 'charge' ? 'Not funded' : 'Billing has not started' : dateTime(project.fundedThrough)],
  ]) {
    const group = element('div'); group.append(element('dt', undefined, label), element('dd', undefined, value)); list.append(group);
  }
  details.append(list); identity.append(details);
  if (project.writesBlocked) identity.append(element('span', 'history-resource-meta', 'Writes paused — export before the funded date'));
  row.append(identity, element('td', 'history-number', formatStorageBytes(project.storedBytes)),
    element('td', 'history-number', formatRuntimeCost(project.chargedCents)), element('td', 'history-number', formatRuntimeCost(project.estimatedMonthlyCents)));
  return row;
}

function renderStorage(data: BalanceHistory) {
  const storage = data.storage;
  document.querySelector<HTMLElement>('#history-storage-section')!.hidden = !storage || storage.pricing.mode === 'off';
  if (!storage) return;
  const pricing = storage.pricing, multiplier = 1 + pricing.markupBps / 10000;
  const timing = pricing.mode === 'meter' ? 'Metering only; no storage deductions yet.'
    : pricing.chargeFrom !== null && pricing.chargeFrom > data.asOf ? `Deductions begin ${dateTime(pricing.chargeFrom)}.` : 'Daily deductions are provisional until the monthly invoice is reconciled.';
  setText('history-storage-pricing', `${timing} Storage: $${(pricing.storageUsdPerGbMonth * multiplier).toFixed(3)}/GB-month; writes and listings: $${(pricing.classAUsdPerMillion * multiplier).toFixed(2)}/million; reads: $${(pricing.classBUsdPerMillion * multiplier).toFixed(3)}/million. Includes ${pricing.markupBps / 100}% markup.`);
  document.querySelector<HTMLElement>('#history-storage')!.replaceChildren(...storage.projects.map(project => storageRow(project, pricing.mode)));
  document.querySelector<HTMLElement>('#history-storage-empty')!.hidden = storage.projects.length > 0;
  document.querySelector<HTMLElement>('#history-storage-scroll')!.hidden = storage.projects.length === 0;
}

function render(data: BalanceHistory) {
  snapshot = data;
  content.hidden = false;
  status.hidden = true;
  error.hidden = true;
  retry.hidden = true;
  renderSummary(data);
  renderResources(data);
  renderFundings(data);
  renderStorage(data);
}

function showRequestError(kind: RequestKind, stale: boolean, historyChanged = false) {
  if (kind === 'resources') {
    resourcesStatus.textContent = historyChanged
      ? 'Resource history changed. Use Refresh to load the latest entries.'
      : 'Could not load more resource history. Try again.';
    return;
  }
  if (kind === 'fundings') {
    fundingsStatus.textContent = historyChanged
      ? 'Balance history changed. Use Refresh to load the latest entries.'
      : 'Could not load more balance additions. Try again.';
    return;
  }
  status.hidden = true;
  error.textContent = stale
    ? 'Could not refresh your balance history. Showing the last loaded snapshot; try again.'
    : 'Could not load your balance history. Check your connection and try again.';
  error.hidden = false;
  retry.textContent = 'Retry';
  retry.hidden = false;
}

function queryUrl(resourceCursor?: string | null, fundingCursor?: string | null) {
  const url = new URL('/billing/history', API_ORIGIN);
  url.searchParams.set('limit', '50');
  if (resourceCursor) url.searchParams.set('resourceCursor', resourceCursor);
  if (fundingCursor) url.searchParams.set('fundingCursor', fundingCursor);
  return url;
}

function isCurrent(version: number, epoch: number) {
  return version === requestVersion && epoch === authEpoch;
}

async function loadFull() {
  if (requestController) requestController.abort();
  const controller = new AbortController();
  requestController = controller;
  const version = ++requestVersion;
  const epoch = authEpoch;
  const hadSnapshot = snapshot !== null;
  setLoading('refresh');
  error.hidden = true;
  retry.hidden = true;
  status.hidden = false;
  status.textContent = hadSnapshot ? 'Refreshing balance history…' : 'Checking session…';
  resourcesStatus.textContent = '';
  fundingsStatus.textContent = '';

  try {
    const session = await auth.readSession();
    if (!isCurrent(version, epoch)) return;
    if (!session?.user) {
      invalidate(true);
      currentUser = null;
      goToLogin();
      return;
    }
    if (currentUser && currentUser.id !== session.user.id) {
      invalidate(true);
      currentUser = session.user;
      void loadFull();
      return;
    }
    currentUser = session.user;
    const response = await fetch(queryUrl(), {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!isCurrent(version, epoch)) return;
    if (response.status === 401) {
      invalidate(true);
      currentUser = null;
      goToLogin();
      return;
    }
    const body = await response.json().catch(() => null);
    if (!isCurrent(version, epoch)) return;
    if (!response.ok) throw new Error('history_unavailable');
    const data = readBalanceHistory(body);
    if (!isCurrent(version, epoch) || !currentUser || currentUser.id !== session.user.id) return;
    render(data);
    publishBalance(session.user, data);
  } catch {
    if (!isCurrent(version, epoch) || controller.signal.aborted) return;
    showRequestError('refresh', hadSnapshot && currentUser !== null);
  } finally {
    if (isCurrent(version, epoch)) {
      requestController = null;
      setLoading(null);
      if (!snapshot && !error.hidden) status.hidden = true;
      if (snapshot && status.textContent === 'Refreshing balance history…') status.hidden = true;
    }
  }
}

function appendUnique<T extends { id: string }>(existing: T[], additions: T[]) {
  const rows = new Map(existing.map(row => [row.id, row]));
  for (const row of additions) rows.set(row.id, row);
  return [...rows.values()];
}

function refreshExisting<T extends { id: string }>(existing: T[], latest: T[]) {
  const rows = new Map(latest.map(row => [row.id, row]));
  return existing.map(row => rows.get(row.id) ?? row);
}

async function loadMore(kind: 'resources' | 'fundings') {
  if (!snapshot || !currentUser || requestKind) return;
  const resourceCursor = kind === 'resources' ? snapshot.nextResourceCursor : null;
  const fundingCursor = kind === 'fundings' ? snapshot.nextFundingCursor : null;
  const cursor = kind === 'resources' ? resourceCursor : fundingCursor;
  if (!cursor) return;
  if (kind === 'resources') resourcesStatus.textContent = 'Loading more resources…';
  else fundingsStatus.textContent = 'Loading more balance additions…';

  const controller = new AbortController();
  requestController = controller;
  const version = ++requestVersion;
  const epoch = authEpoch;
  const userId = currentUser.id;
  setLoading(kind);
  try {
    const response = await fetch(queryUrl(resourceCursor, fundingCursor), {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!isCurrent(version, epoch)) return;
    if (response.status === 401) {
      invalidate(true);
      currentUser = null;
      goToLogin();
      return;
    }
    const body = await response.json().catch(() => null);
    if (!isCurrent(version, epoch)) return;
    if (!response.ok) throw new Error(body?.error === 'invalid_history_cursor' ? 'history_changed' : 'history_unavailable');
    const data = readBalanceHistory(body);
    if (!isCurrent(version, epoch) || !currentUser || currentUser.id !== userId || !snapshot) return;
    const previous = snapshot;
    snapshot = {
      ...data,
      resources: kind === 'resources' ? appendUnique(previous.resources, data.resources) : refreshExisting(previous.resources, data.resources),
      fundings: kind === 'fundings' ? appendUnique(previous.fundings, data.fundings) : refreshExisting(previous.fundings, data.fundings),
      activeResources: data.activeResources,
      nextResourceCursor: kind === 'resources' ? data.nextResourceCursor : previous.nextResourceCursor,
      nextFundingCursor: kind === 'fundings' ? data.nextFundingCursor : previous.nextFundingCursor,
    };
    render(snapshot);
    publishBalance(currentUser, data);
    if (kind === 'resources') resourcesStatus.textContent = '';
    else fundingsStatus.textContent = '';
  } catch (caught) {
    if (!isCurrent(version, epoch) || controller.signal.aborted) return;
    const historyChanged = caught instanceof Error && caught.message === 'history_changed';
    if (historyChanged && snapshot) {
      if (kind === 'resources') { snapshot.nextResourceCursor = null; resourcesMore.hidden = true; }
      else { snapshot.nextFundingCursor = null; fundingsMore.hidden = true; }
    }
    showRequestError(kind, true, historyChanged);
  } finally {
    if (isCurrent(version, epoch)) {
      requestController = null;
      setLoading(null);
      if (snapshot) {
        resourcesMore.disabled = !snapshot.nextResourceCursor || !currentUser;
        fundingsMore.disabled = !snapshot.nextFundingCursor || !currentUser;
      }
    }
  }
}

refresh.addEventListener('click', () => { void loadFull(); });
retry.addEventListener('click', () => { void loadFull(); });
resourcesMore.addEventListener('click', () => { void loadMore('resources'); });
fundingsMore.addEventListener('click', () => { void loadMore('fundings'); });

window.addEventListener('auth-change', event => {
  if (!event.detail || !('user' in event.detail)) {
    void loadFull();
    return;
  }
  const nextUser = event.detail.user;
  if (nextUser?.id && currentUser?.id === nextUser.id) return;
  if (!nextUser) {
    invalidate(true);
    currentUser = null;
    status.hidden = true;
    error.hidden = true;
    goToLogin();
    return;
  }
  const accountChanged = currentUser !== null && currentUser.id !== nextUser.id;
  invalidate(true);
  currentUser = null;
  if (accountChanged) {
    window.location.reload();
    return;
  }
  status.hidden = false;
  status.textContent = 'Checking session…';
  void loadFull();
});

window.addEventListener('cookie-consent-change', () => { void loadFull(); });

void loadFull();
