import type { User, PrepaidBalance, PrepaidBillingConfig } from './types.ts';
import { API_ORIGIN, createAuthClient } from './auth.ts';
import { needsSignInCookies, signInCookieMessage } from './cookie-preferences.ts';
import { trackConfirmedPayment, trackFunnel } from './acquisition-analytics.ts';
import { dollarsToCents, formatBalance, readPrepaidBalance } from './prepaid-billing.ts';
import { mountStripeEmbeddedCheckout } from './payments/stripeEmbeddedCheckout.ts';

const auth = createAuthClient();
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const walletView = element('prepaid-billing');
const status = element('billing-status');
const login = element<HTMLAnchorElement>('billing-login');
const amount = element<HTMLInputElement>('topup-amount');
const topup = element<HTMLButtonElement>('topup-submit');
const cap = element<HTMLInputElement>('usage-spend-limit');
const capSave = element<HTMLButtonElement>('usage-save');
const rechargeEnabled = element<HTMLInputElement>('recharge-enabled');
const rechargeAmount = element<HTMLInputElement>('recharge-amount');
const rechargeMaximum = element<HTMLInputElement>('recharge-maximum');
const rechargeSave = element<HTMLButtonElement>('recharge-save');
const refresh = element<HTMLButtonElement>('billing-refresh');
const presets = [...document.querySelectorAll<HTMLButtonElement>('[data-topup-cents]')];
const checkoutView = element('inline-checkout');
const checkoutForm = element<HTMLFormElement>('checkout-form');
const checkoutEmail = element<HTMLInputElement>('checkout-email');
const checkoutBack = element<HTMLButtonElement>('checkout-back');
const checkoutSlot = element('checkout-payment-slot');
const checkoutPromotionInput = element<HTMLInputElement>('checkout-promotion-code');
const checkoutPromotionApply = element<HTMLButtonElement>('checkout-promotion-apply');
const checkoutPromotionRemove = element<HTMLButtonElement>('checkout-promotion-remove');
const checkoutPromotionStatus = element('checkout-promotion-status');
let cleanupCheckout: (() => void) | null = null;
let checkoutVersion = 0;
let checkoutProcessing = false;
let user: User | null = null;
let config: PrepaidBillingConfig | null = null;
let balance: PrepaidBalance | null = null;
let version = 0;
let busy = false;
let loading = true;
let capDirty = false;
let rechargeDirty = false;
const returnParams = new URLSearchParams(location.search);
let completionSession = returnParams.get('topup_session') || (returnParams.get('topup_return') === '1' ? returnParams.get('session_id') : null);
let completionUserId: string | null = null;
let balanceReadVersion = 0;

type PendingTopup = { requestId: string; amountCents: number; sessionId?: string };
let pendingTopup: PendingTopup | null = null;
function storageKey() { return `mainbrella-prepaid-topup:${user?.id}`; }
function restorePending() {
  pendingTopup = null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey()) || 'null');
    if (saved && typeof saved.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(saved.requestId)
      && Number.isSafeInteger(saved.amountCents) && saved.amountCents >= 500
      && (!saved.sessionId || typeof saved.sessionId === 'string')) pendingTopup = saved;
  } catch { /* Blocked storage still allows retries within this page. */ }
  if (pendingTopup) amount.value = (pendingTopup.amountCents / 100).toFixed(2);
}
function rememberPending(value: PendingTopup | null) {
  pendingTopup = value;
  try {
    if (value) window.sessionStorage.setItem(storageKey(), JSON.stringify(value));
    else window.sessionStorage.removeItem(storageKey());
  } catch { /* Keep the same request ID in memory when storage is blocked. */ }
}
class BillingError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function readConfig(value: unknown): PrepaidBillingConfig | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as PrepaidBillingConfig;
  return typeof data.configured === 'boolean'
    && Number.isSafeInteger(data.minTopupCents) && data.minTopupCents >= 500
    && Number.isSafeInteger(data.maxTopupCents) && data.maxTopupCents >= data.minTopupCents ? data : null;
}
async function api(path: string, body?: unknown) {
  if (path !== '/billing/config' && needsSignInCookies()) throw new Error(signInCookieMessage);
  const response = await fetch(API_ORIGIN + path, {
    credentials: needsSignInCookies() ? 'omit' : 'include',
    method: body === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new BillingError(data?.error || 'billing_unavailable', response.status);
  if (!data) throw new Error('billing_unavailable');
  return data;
}
function feedback(target: HTMLElement, text: string, error = false) {
  target.textContent = text;
  target.dataset.state = error ? 'error' : '';
}
function expired(error: unknown) {
  if (!(error instanceof BillingError) || error.status !== 401) return false;
  window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: null } }));
  feedback(status, 'Your session expired. Sign in to continue.', true);
  return true;
}
function applyBalance(value: unknown) {
  balance = readPrepaidBalance(value);
  window.dispatchEvent(new CustomEvent('billing-balance-change', { detail: { userId: user!.id, balance } }));
}
function setPaymentLoading(value: boolean) {
  checkoutSlot.dataset.loading = String(value);
  checkoutSlot.setAttribute('aria-busy', String(value));
}
function closeCheckout() {
  checkoutVersion++;
  cleanupCheckout?.();
  cleanupCheckout = null;
  checkoutView.hidden = true;
  checkoutEmail.disabled = true;
  if (checkoutProcessing) {
    checkoutProcessing = false;
    busy = false;
    window.dispatchEvent(new CustomEvent('checkout-processing', { detail: { processing: false } }));
  }
}
function render() {
  walletView.hidden = !user;
  login.hidden = Boolean(user) || loading;
  const ready = Boolean(user && balance && config?.configured && !loading && !busy);
  topup.disabled = !ready || !checkoutView.hidden || Boolean(completionSession);
  cap.disabled = !ready;
  capSave.disabled = !ready;
  rechargeEnabled.disabled = !ready;
  rechargeAmount.disabled = !ready || !rechargeEnabled.checked;
  rechargeMaximum.disabled = !ready || !rechargeEnabled.checked;
  rechargeSave.disabled = !ready;
  refresh.disabled = !user || loading || busy;
  presets.forEach(button => { button.disabled = !ready || !checkoutView.hidden || Boolean(completionSession); });
  amount.disabled = !ready || !checkoutView.hidden || Boolean(completionSession);
  checkoutBack.disabled = checkoutProcessing;
  element('billing-balance').textContent = balance ? formatBalance(balance.balanceCents) : '—';
  element('billing-available').textContent = balance ? formatBalance(balance.availableBalanceCents) : '—';
  element('billing-reserved').textContent = balance ? formatBalance(balance.reservedBalanceCents) : '—';
  element('billing-usage').textContent = balance ? formatBalance(balance.monthlyUsageCents) : '—';
  const runtime = element('billing-runtime');
  runtime.hidden = !balance?.productionHourlyCents;
  if (balance?.productionHourlyCents) {
    const hours = (balance.fundedRuntimeMs || 0) / 3_600_000;
    runtime.textContent = `Your balance funds the current production fleet for approximately ${hours >= 24 ? `${(hours / 24).toFixed(1)} days` : `${hours.toFixed(1)} hours`}. Your monthly cap may stop compute sooner.`;
  }
  if (balance && !capDirty) cap.value = (balance.spendLimitCents / 100).toFixed(2);
  if (balance && !rechargeDirty) {
    rechargeEnabled.checked = balance.autoRecharge.enabled;
    rechargeAmount.value = (balance.autoRecharge.amountCents / 100).toFixed(2);
    rechargeMaximum.value = (balance.autoRecharge.monthlyLimitCents / 100).toFixed(2);
    rechargeAmount.disabled = !ready || !rechargeEnabled.checked;
    rechargeMaximum.disabled = !ready || !rechargeEnabled.checked;
  }
  element('recharge-options').hidden = !rechargeEnabled.checked;
  const rechargeStatus = element('recharge-payment-status');
  const recharge = balance?.autoRecharge;
  rechargeStatus.hidden = !recharge?.enabled;
  if (recharge?.enabled) {
    rechargeStatus.textContent = recharge.status === 'requires_action'
      ? 'Your last recharge needs payment authentication. Add balance manually, then save recharge to reenable future charges.'
      : recharge.status === 'failed'
      ? 'Your last recharge failed. Add balance manually, then save recharge to reenable future charges.'
      : recharge.status === 'processing'
      ? 'A recharge is processing. Funds become available after payment succeeds.'
      : recharge.status === 'monthly_limit_reached'
      ? 'Automatic recharge reached its monthly maximum. Add balance manually or raise the recharge maximum to keep compute funded.'
      : recharge.status === 'reconciliation_required'
      ? 'A recharge needs payment verification. Pending funds are unavailable; add balance manually if needed.'
      : `${formatBalance(recharge.spentCents)} recharged this UTC month, up to ${formatBalance(recharge.monthlyLimitCents)}.`;
    rechargeStatus.dataset.state = ['requires_action', 'failed', 'monthly_limit_reached', 'reconciliation_required'].includes(recharge.status) ? 'error' : '';
  }
  if (config) {
    amount.min = String(config.minTopupCents / 100);
    amount.max = String(config.maxTopupCents / 100);
    element('topup-note').textContent = `Minimum ${formatBalance(config.minTopupCents)}. Your balance carries forward. Checkout shows any applicable taxes before you pay.`;
  }
}
async function loadBalance(accountVersion = version) {
  const readVersion = ++balanceReadVersion;
  const data = await api('/billing/balance');
  if (accountVersion !== version || readVersion !== balanceReadVersion || !user) return;
  applyBalance(data.balance);
}
async function completePayment(accountVersion: number, retryInForm = false) {
  if (!completionSession || !user) return;
  completionUserId = user.id;
  const sessionId = completionSession;
  feedback(status, 'Confirming your payment…');
  try {
    const data = await api('/billing/topups/complete', { sessionId });
    if (accountVersion !== version || !user) return;
    applyBalance(data.balance);
    if (!pendingTopup?.sessionId || pendingTopup.sessionId === sessionId) rememberPending(null);
    completionSession = null;
    completionUserId = null;
    closeCheckout();
    const url = new URL(location.href);
    url.searchParams.delete('topup_session');
    url.searchParams.delete('topup_return');
    url.searchParams.delete('session_id');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    trackConfirmedPayment(sessionId, 'prepaid');
    feedback(status, 'Payment confirmed. Your prepaid balance is ready.');
  } catch (error) {
    if (accountVersion !== version || expired(error)) return;
    const pending = error instanceof BillingError && ['payment_pending', 'topup_pending', 'payment_not_complete'].includes(error.code);
    if (error instanceof BillingError && ['checkout_expired', 'topup_expired'].includes(error.code)) {
      rememberPending(null);
      completionSession = null;
      completionUserId = null;
      closeCheckout();
    }
    const message = pending
      ? 'Payment is still pending. No funds have been added yet. Refresh to check again.'
      : 'Could not confirm the payment. Refresh to check again before starting another payment.';
    feedback(status, message, true);
    if (retryInForm) throw new Error(message);
  }
}
async function load(knownUser?: User | null) {
  const accountVersion = ++version;
  closeCheckout();
  balanceReadVersion++;
  loading = true;
  busy = false;
  balance = null;
  amount.value = '20.00';
  for (const id of ['topup-status', 'usage-status', 'recharge-status']) feedback(element(id), '');
  capDirty = false;
  rechargeDirty = false;
  rechargeEnabled.checked = false;
  user = knownUser ?? null;
  feedback(status, 'Checking billing…');
  render();
  const results = await Promise.allSettled([
    api('/billing/config'),
    knownUser === undefined ? auth.readSession() : Promise.resolve(knownUser ? { user: knownUser } : null),
  ]);
  if (accountVersion !== version) return;
  const [configuration, session] = results;
  config = configuration.status === 'fulfilled' ? readConfig(configuration.value) : null;
  if (session.status === 'fulfilled') user = session.value?.user || null;
  else feedback(status, 'Could not check your sign-in. Refresh the page to try again.', true);
  if (completionUserId && completionUserId !== user?.id) {
    completionSession = null;
    completionUserId = null;
  }
  if (user) {
    restorePending();
    try {
      await loadBalance(accountVersion);
      if (accountVersion !== version) return;
      feedback(status, config?.configured ? '' : 'Payments are unavailable. Please try again later.', !config?.configured);
      if (completionSession) await completePayment(accountVersion);
    } catch (error) {
      if (accountVersion !== version || expired(error)) return;
      feedback(status, 'Could not load your balance. Refresh to try again.', true);
    }
  } else if (session.status === 'fulfilled') {
    feedback(status, needsSignInCookies() ? signInCookieMessage : 'Sign in to add prepaid balance.');
  }
  if (accountVersion !== version) return;
  loading = false;
  render();
}

presets.forEach(button => button.addEventListener('click', () => { amount.value = (Number(button.dataset.topupCents) / 100).toFixed(2); }));
checkoutBack.addEventListener('click', () => {
  if (checkoutProcessing) return;
  closeCheckout();
  render();
  topup.focus();
});
element<HTMLFormElement>('topup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || loading || !user || !balance || !config?.configured || !checkoutView.hidden || completionSession) return;
  const amountCents = dollarsToCents(amount.value);
  if (amountCents === null || amountCents < config.minTopupCents || amountCents > config.maxTopupCents) {
    feedback(element('topup-status'), `Enter an amount from ${formatBalance(config.minTopupCents)} to ${formatBalance(config.maxTopupCents)}, with up to two decimal places.`, true);
    amount.focus();
    return;
  }
  if (pendingTopup && pendingTopup.amountCents !== amountCents) {
    amount.value = (pendingTopup.amountCents / 100).toFixed(2);
    feedback(element('topup-status'), `A ${formatBalance(pendingTopup.amountCents)} top-up is already in progress. Continue that checkout before adding another amount.`, true);
    return;
  }
  rememberPending(pendingTopup || { requestId: crypto.randomUUID(), amountCents });
  const accountVersion = version;
  busy = true;
  feedback(element('topup-status'), 'Opening secure checkout…');
  render();
  try {
    let data;
    try {
      data = await api('/billing/topups', { requestId: pendingTopup!.requestId, amountCents });
    } catch (error) {
      if (accountVersion !== version || !user) return;
      if (!(error instanceof BillingError) || !['checkout_expired', 'topup_expired'].includes(error.code)) throw error;
      // Stripe has confirmed the old checkout can no longer charge. Replace
      // its purchase identity once, without requiring a second user action.
      rememberPending({ requestId: crypto.randomUUID(), amountCents });
      data = await api('/billing/topups', { requestId: pendingTopup!.requestId, amountCents });
    }
    if (accountVersion !== version || !user) return;
    if (typeof data.sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(data.sessionId)
      || typeof data.client_secret !== 'string' || !data.client_secret.startsWith(`${data.sessionId}_secret_`)
      || typeof data.publishable_key !== 'string' || !/^pk_(test|live)_\S+$/.test(data.publishable_key)) throw new Error('invalid_checkout');
    rememberPending({ ...pendingTopup!, sessionId: data.sessionId });
    trackFunnel('checkout_started', { plan: 'prepaid' });
    checkoutView.hidden = false;
    checkoutEmail.value = user.email || '';
    checkoutEmail.disabled = false;
    checkoutEmail.readOnly = false;
    const submitLabel = `Pay ${formatBalance(amountCents)}`;
    const submit = element<HTMLButtonElement>('checkout-submit');
    submit.textContent = submitLabel;
    element('checkout-total').textContent = `Due today: ${formatBalance(amountCents)}`;
    setPaymentLoading(true);
    feedback(element('topup-status'), '');
    const mountVersion = ++checkoutVersion;
    const current = () => accountVersion === version && mountVersion === checkoutVersion && Boolean(user);
    cleanupCheckout = mountStripeEmbeddedCheckout({
      container: element('checkout-payment'), form: checkoutForm,
      submitButton: submit, statusElement: element('checkout-status'),
      emailInput: checkoutEmail, totalElement: element('checkout-total'),
      promotionInput: checkoutPromotionInput, promotionApply: checkoutPromotionApply,
      promotionRemove: checkoutPromotionRemove, promotionStatus: checkoutPromotionStatus,
      clientSecret: data.client_secret, publishableKey: data.publishable_key, submitLabel,
      onReady: () => { if (current()) setPaymentLoading(false); },
      onError: () => { if (current()) setPaymentLoading(false); },
      onProcessing: processing => {
        if (!current()) return;
        checkoutProcessing = processing;
        busy = processing;
        checkoutEmail.disabled = processing;
        window.dispatchEvent(new CustomEvent('checkout-processing', { detail: { processing } }));
        render();
      },
      onComplete: async session => {
        if (!current()) return;
        if (session?.id !== data.sessionId) throw new Error('Could not verify this payment. Refresh to check your balance.');
        completionSession = session.id;
        await completePayment(accountVersion, true);
        if (accountVersion === version) render();
      },
    });
    element('checkout-title').focus();
  } catch (error) {
    if (accountVersion !== version || expired(error)) return;
    if (error instanceof BillingError && ['checkout_expired', 'topup_expired'].includes(error.code)) rememberPending(null);
    if (error instanceof BillingError && error.code === 'topup_already_complete') {
      if (pendingTopup?.sessionId) {
        completionSession = pendingTopup.sessionId;
        await completePayment(accountVersion);
      } else {
        rememberPending(null);
        await loadBalance(accountVersion).catch(() => {});
        if (accountVersion === version) feedback(element('topup-status'), 'That payment is already complete. Refresh to check your balance.', true);
      }
    } else feedback(element('topup-status'), error instanceof BillingError && ['checkout_expired', 'topup_expired'].includes(error.code)
      ? 'Could not prepare a new payment form. Please try again.'
      : 'Could not open checkout. No balance was added. Retry to continue the same payment.', true);
  } finally {
    if (accountVersion === version) { busy = false; render(); }
  }
});
cap.addEventListener('input', () => { capDirty = true; });
for (const input of [rechargeEnabled, rechargeAmount, rechargeMaximum]) {
  input.addEventListener('input', () => { rechargeDirty = true; render(); });
}
async function saveSettings(body: unknown, target: HTMLElement, success: string) {
  if (busy || loading || !user || !balance || !config?.configured) return;
  const accountVersion = version;
  busy = true;
  feedback(target, 'Saving…');
  render();
  try {
    const data = await api('/billing/settings', body);
    if (accountVersion !== version || !user) return;
    applyBalance(data.balance);
    if (target.id === 'usage-status') capDirty = false;
    else rechargeDirty = false;
    feedback(target, success);
  } catch (error) {
    if (accountVersion !== version || expired(error)) return;
    const code = error instanceof BillingError ? error.code : '';
    feedback(target, code === 'payment_method_required'
      ? 'Add balance first to save a payment method, then enable automatic recharge.'
      : ['spend_limit_below_usage', 'spend_limit_below_committed', 'spend_limit_below_committed_usage'].includes(code)
      ? 'Your cap must cover compute already used or reserved this month.'
      : 'Could not save these settings. Your inputs are preserved; try again.', true);
  } finally {
    if (accountVersion === version) { busy = false; render(); }
  }
}
element<HTMLFormElement>('usage-limit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const cents = dollarsToCents(cap.value);
  if (cents === null || cents < 500 || cents > 100000) {
    feedback(element('usage-status'), 'Enter a monthly spending cap from $5.00 to $1,000.00.', true);
    cap.focus();
    return;
  }
  await saveSettings({ spendLimitCents: cents }, element('usage-status'), 'Monthly spending cap saved.');
});
element<HTMLFormElement>('recharge-form').addEventListener('submit', async event => {
  event.preventDefault();
  const amountCents = dollarsToCents(rechargeAmount.value);
  const monthlyLimitCents = dollarsToCents(rechargeMaximum.value);
  if (rechargeEnabled.checked && (amountCents === null || monthlyLimitCents === null || amountCents < 500
    || amountCents > 100000 || monthlyLimitCents < amountCents || monthlyLimitCents > 100000)) {
    feedback(element('recharge-status'), 'Choose a recharge amount from $5 to $1,000 and a monthly maximum at least that amount, up to $1,000.', true);
    return;
  }
  await saveSettings({ autoRecharge: {
    enabled: rechargeEnabled.checked,
    amountCents: rechargeEnabled.checked ? amountCents : balance?.autoRecharge.amountCents ?? 2000,
    monthlyLimitCents: rechargeEnabled.checked ? monthlyLimitCents : balance?.autoRecharge.monthlyLimitCents ?? 10000,
  } }, element('recharge-status'), rechargeEnabled.checked ? 'Automatic recharge enabled.' : 'Automatic recharge disabled.');
});
refresh.addEventListener('click', async () => {
  if (loading || busy || !user) return;
  const accountVersion = version;
  loading = true;
  feedback(status, 'Refreshing balance…');
  render();
  try {
    const [configuration, currentBalance] = await Promise.allSettled([api('/billing/config'), loadBalance(accountVersion)]);
    if (accountVersion !== version) return;
    config = configuration.status === 'fulfilled' ? readConfig(configuration.value) : null;
    if (currentBalance.status === 'rejected') throw currentBalance.reason;
    feedback(status, config?.configured ? 'Balance refreshed.' : 'Payments are unavailable. Please try again later.', !config?.configured);
    if (completionSession) await completePayment(accountVersion);
  } catch (error) {
    if (accountVersion === version && !expired(error)) feedback(status, 'Could not load your balance. Refresh to try again.', true);
  } finally { if (accountVersion === version) { loading = false; render(); } }
});
window.addEventListener('auth-change', event => { void load(event.detail?.user); });
window.addEventListener('cookie-consent-change', () => { void load(); });
window.addEventListener('billing-balance-change', event => {
  if (!user || event.detail?.userId !== user.id) return;
  if (event.detail.balance) {
    try { balance = readPrepaidBalance(event.detail.balance); balanceReadVersion++; render(); } catch { /* Keep verified balance if an unrelated publisher sends bad data. */ }
  } else if (!loading && !busy) {
    void loadBalance().then(render).catch(() => { feedback(status, 'Could not refresh your balance. Refresh to try again.', true); });
  }
});
void load();
