import { needsSignInCookies, signInCookieMessage } from './cookie-preferences.js';
import { mountStripeEmbeddedCheckout } from "./payments/stripeEmbeddedCheckout.js";
import { API_ORIGIN, createAuthClient } from "./auth.js";
import { plans } from "./plans.js";
const apiOrigin = API_ORIGIN;
const planButtons = [...document.querySelectorAll("[data-plan]")];
const manage = document.querySelector("#billing-manage");
const cancelButton = document.querySelector("#billing-cancel");
const resumeButton = document.querySelector("#billing-resume");
const routeSlug = location.pathname.match(/^\/pricing\/([^/]+)\/?$/)?.[1];
const selectedPlan = Object.hasOwn(plans, routeSlug) ? routeSlug : null;
const planPath = (plan) => `/pricing/${plan}`;
const priceFor = (plan) => config?.plans?.[plan]?.price ?? plans[plan].price;
if (selectedPlan) {
  document.title = `${plans[selectedPlan].name} subscription · Mainbrella`;
  document.querySelector("#plan-title").textContent = `${plans[selectedPlan].name} — $${plans[selectedPlan].price}/month`;
  planButtons.forEach((button) => { button.dataset.plan = selectedPlan; });
}
const checkoutView = document.querySelector("#inline-checkout");
const checkoutForm = document.querySelector("#checkout-form");
const checkoutEmail = document.querySelector("#checkout-email");
const checkoutBack = document.querySelector("#checkout-back");
const checkoutPaymentSlot = document.querySelector("#checkout-payment-slot");
let checkoutProcessing = false;
let cleanupCheckout;
let checkoutVersion = 0;
let busy = false;
function setPaymentLoading(loading) {
  if (!checkoutPaymentSlot) return;
  checkoutPaymentSlot.dataset.loading = String(loading);
  checkoutPaymentSlot.ariaBusy = String(loading);
}
function showCheckoutShell(plan) {
  checkoutView.hidden = false;
  document.querySelector("#pricing-plans").hidden = true;
  document.querySelector("#checkout-title").textContent = `${plans[plan].name} — $${priceFor(plan)}/month`;
  checkoutEmail.value = user?.email || "";
  checkoutEmail.readOnly = false;
  checkoutEmail.disabled = true;
  checkoutForm.hidden = false;
  const submit = document.querySelector("#checkout-submit");
  submit.disabled = true;
  submit.textContent = `Subscribe for $${priceFor(plan)}/month`;
  const checkoutStatus = document.querySelector("#checkout-status");
  checkoutStatus.textContent = "Preparing secure payment…";
  checkoutStatus.dataset.state = "pending";
  setPaymentLoading(true);
}
function closeCheckout() {
  checkoutVersion++;
  busy = false;
  checkoutProcessing = false;
  cleanupCheckout?.();
  cleanupCheckout = null;
  setPaymentLoading(true);
  checkoutView.hidden = true;
  checkoutForm.hidden = true;
  document.querySelector("#checkout-total").textContent = "";
  document.querySelector("#pricing-plans").hidden = false;
}
function disablePlans(disabled) {
  planButtons.forEach((button) => { button.disabled = disabled; });
}
function renderPolicy() {
  if (!config?.plans) return;
  document.querySelectorAll(".plan").forEach((card) => {
    const button = card.querySelector("[data-plan]");
    const plan = config.plans[button?.dataset.plan];
    if (!plan) return;
    const key = button.dataset.plan;
    const limits = plan.limits;
    card.querySelector("h3").textContent = plan.name;
    const price = card.querySelector(".plan-price");
    if (price?.firstChild) price.firstChild.textContent = `$${plan.price}`;
    const hours = limits.maxSessionMs / 3600000;
    const idle = limits.idleTimeoutMs / 60000;
    const rules = [
      limits.maxComputeUnitHours ? `${limits.maxComputeUnitHours.toLocaleString()} compute-unit hours/month` : `${limits.maxContainers} concurrent containers`,
      `${limits.maxStartsPerMonth.toLocaleString()} starts per month`,
      `Up to ${hours}-hour sessions · ${idle}-minute idle timeout`,
      `All five sizes · Up to 4 vCPU / 12 GiB RAM`,
      limits.maxConcurrentComputeUnits ? `${limits.maxContainers} containers within ${limits.maxConcurrentComputeUnits} concurrent units` : "SSH, browser terminal, internet access",
    ];
    card.querySelectorAll(".plan-features li").forEach((item, index) => {
      if (!rules[index]) return;
      if (index === 0) {
        const emphasized = document.createElement("strong");
        emphasized.textContent = rules[index];
        item.replaceChildren(emphasized);
      } else item.textContent = rules[index];
    });
    if (!selectedPlan) button.textContent = key === "builder"
      ? `Start building — $${plan.price}/month`
      : `Choose ${plan.name} — $${plan.price}/month`;
  });
  if (selectedPlan) {
    const details = config.plans[selectedPlan];
    document.querySelector("#plan-title").textContent = `${details.name} — $${details.price}/month`;
    const limits = details.limits;
    const compute = limits.maxComputeUnitHours ? `${limits.maxComputeUnitHours.toLocaleString()} compute-unit hours/month · All five sizes · ` : "";
    const capacity = limits.maxConcurrentComputeUnits ? ` within ${limits.maxConcurrentComputeUnits} compute units` : "";
    const summary = document.querySelector("#selected-plan-limits");
    summary.textContent = `${compute}${limits.maxContainers} concurrent containers${capacity} · ${limits.maxStartsPerMonth.toLocaleString()} starts per UTC month · Up to ${limits.maxSessionMs / 3600000}-hour sessions · ${limits.idleTimeoutMs / 60000}-minute idle timeout.`;
    summary.hidden = false;
  }
}
const status = document.querySelector("#pro-status");
const account = document.querySelector("#pro-account");
const logout = document.querySelector("#pro-logout");
const login = document.querySelector("#pro-login");
if (selectedPlan) login.href = `/login?returnTo=${encodeURIComponent(planPath(selectedPlan))}`;
let user = null;
let config = null;
let subscription = null;
let subscriptionState = null;
let ready = false;
let authVersion = 0;

async function api(path, body) {
  if (needsSignInCookies()) {
    if (path === '/auth/me') return { user: null };
    if (path !== '/subscription/config') throw new Error(signInCookieMessage);
  }
  const response = await fetch(apiOrigin + path, {
    credentials: path === "/subscription/config" ? "omit" : "include",
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
}
function message(text, error = false) {
  status.textContent = text;
  status.dataset.state = error ? "error" : "";
}
function billingError(error, fallback) {
  return {
    billing_operation_pending: "Another billing change is in progress. Refresh your subscription before trying again.",
    scheduled_change_exists: "Cancel the scheduled change with Keep current plan before upgrading.",
    cancellation_pending: "Resume your subscription before changing plans.",
  }[error?.message] || fallback;
}
function periodEnd() {
  const end = subscriptionState?.valid_until
    || (subscription?.cancel_at || subscription?.items?.data[0]?.current_period_end || subscription?.current_period_end) * 1000;
  return Number.isFinite(end) && end > 0
    ? `on ${new Date(end).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'at the end of the current billing period';
}
function render() {
  const checkoutStage = document.querySelector("#checkout-stage");
  if (checkoutStage) {
    checkoutStage.dataset.reserve = String(!ready || !checkoutView.hidden);
    checkoutStage.dataset.checkout = String(!checkoutView.hidden);
  }
  account.hidden = !user;
  account.textContent = user ? `Signed in as ${user.email || user.name}` : "";
  logout.hidden = !user;
  login.hidden = Boolean(user) || !checkoutView.hidden;
  manage.hidden = !subscription;
  manage.disabled = busy || !ready;
  if (cancelButton) cancelButton.disabled = busy || !ready;
  if (resumeButton) resumeButton.disabled = busy || !ready;
  logout.disabled = busy || checkoutProcessing;
  if (cancelButton) cancelButton.hidden = !subscription
    || Boolean(subscription.cancel_at_period_end || subscriptionState?.cancel_at_period_end);
  if (resumeButton) resumeButton.hidden = !subscription
    || !(subscription.cancel_at_period_end || subscriptionState?.cancel_at_period_end);
  planButtons.forEach((button) => {
    const targetPlan = selectedPlan || button.dataset.plan;
    const currentPlan = subscriptionState?.plan;
    const scheduledPlan = subscriptionState?.scheduled_plan;
    const keepCurrent = currentPlan === targetPlan && Boolean(scheduledPlan);
    const isCurrent = currentPlan === targetPlan && !scheduledPlan && !subscriptionState?.trial;
    const needsPayment = user && subscription && !subscriptionState?.active;
    button.disabled = busy || !ready || isCurrent || Boolean(needsPayment);
    if (user && subscriptionState?.active && !subscriptionState?.trial) {
      const rank = { builder: 0, pro: 1, scale: 2 };
      button.textContent = keepCurrent
        ? `Keep ${plans[targetPlan].name}`
        : isCurrent
          ? `${plans[targetPlan].name} · Current plan`
          : rank[targetPlan] > rank[currentPlan]
            ? `Upgrade to ${plans[targetPlan].name} — $${priceFor(targetPlan)}/month`
            : `Change to ${plans[targetPlan].name} — $${priceFor(targetPlan)}/month`;
    } else if (needsPayment) {
      button.textContent = 'Payment needed · Manage billing';
    } else {
      button.textContent = selectedPlan
        ? `Subscribe to ${plans[targetPlan].name} — $${priceFor(targetPlan)}/month`
        : targetPlan === 'builder'
          ? `Start building — $${priceFor(targetPlan)}/month`
          : `Choose ${plans[targetPlan].name} — $${priceFor(targetPlan)}/month`;
    }
  });
}
function applySubscription(data) {
  const validTrial = data.trial?.plan === data.plan && Number.isFinite(data.trial?.expires_at)
    && data.trial.expires_at > Date.now() && data.valid_until === data.trial.expires_at;
  if (typeof data.active !== 'boolean' || (data.active && (!Object.hasOwn(plans, data.plan) || (!data.subscription && !validTrial)))) {
    throw new Error('billing_unavailable');
  }
  subscription = data.subscription;
  subscriptionState = data;
  if (data.active) {
    const name = plans[data.plan]?.name || "Your plan";
    if (data.trial) {
      message(`Your ${name} free trial ends ${periodEnd()}. No automatic charges. Subscribe to continue after your trial.`);
    } else if (data.scheduled_plan) {
      const date = data.scheduled_change_at ? new Date(data.scheduled_change_at * 1000).toLocaleDateString() : "renewal";
      message(`${name} is active. Your plan changes to ${plans[data.scheduled_plan]?.name || data.scheduled_plan} on ${date}.`);
    } else if (subscription?.cancel_at_period_end || data.cancel_at_period_end) {
      message(`${name} is active. Your subscription ends ${periodEnd()}.`);
    } else message(`Your ${name} subscription is active.`);
  } else if (subscription) {
    message("Your subscription needs attention. Manage billing to update payment details or cancel.");
  } else {
    message("Choose a plan to start your monthly subscription.");
  }
}
async function refresh() {
  const version = authVersion;
  const data = await api("/subscription");
  if (version !== authVersion) return false;
  applySubscription(data);
  return true;
}
async function initialize() {
  const version = authVersion;
  ready = false;
  disablePlans(true);
  try {
    const [configuration, session] = await Promise.all([api("/subscription/config"), api("/auth/me")]);
    config = configuration;
    if (config.plans) {
      for (const [key, details] of Object.entries(config.plans)) {
        if (Object.hasOwn(plans, key) && Number.isFinite(details.price)) plans[key].price = details.price;
        if (Object.hasOwn(plans, key) && details.name) plans[key].name = details.name;
      }
      renderPolicy();
    }
    if (version !== authVersion) {
      ready = Boolean(config.configured);
      render();
      return;
    }
    user = session.user;
    if (!config.configured) throw new Error("billing_unavailable");
    render();
    if (selectedPlan && !user) {
      location.assign(`/login?returnTo=${encodeURIComponent(planPath(selectedPlan))}`);
      return;
    }
    const params = new URLSearchParams(location.search);
    const returningFromCheckout = params.has("subscription_return") || params.has("subscription_cancelled");
    let completed = false;
    if (user && params.get("subscription_return") === "1" && params.get("session_id")) {
      message("Confirming your subscription…");
      const confirmation = await api("/subscription/complete", { session_id: params.get("session_id") });
      if (version !== authVersion) return;
      applySubscription(confirmation);
      completed = true;
      params.delete("subscription_return");
      params.delete("session_id");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    if (user && !completed) await refresh();
    else if (!user) message(needsSignInCookies() ? signInCookieMessage : "Sign in to subscribe.");
    if (version !== authVersion) return;
    if (params.get("subscription_return") === "1" && !user) {
      message("You’ve returned from Stripe. For help with your subscription, contact support@mainbrella.com.");
      params.delete("subscription_return");
      params.delete("session_id");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    if (params.get("subscription_cancelled") === "1") {
      message("Checkout canceled. You can subscribe whenever you’re ready.");
      params.delete("subscription_cancelled");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    ready = true;
    if (selectedPlan && user && !subscription && !subscriptionState?.active && !returningFromCheckout) {
      await openCheckout(selectedPlan);
    } else {
      if (selectedPlan) closeCheckout();
      render();
    }
  } catch {
    if (version !== authVersion) return;
    ready = false;
    message("Subscriptions are temporarily unavailable. Please try again.", true);
    if (selectedPlan && !checkoutView.hidden) {
      const checkoutStatus = document.querySelector("#checkout-status");
      checkoutStatus.textContent = "Subscriptions are temporarily unavailable. Refresh to try again.";
      checkoutStatus.dataset.state = "error";
      setPaymentLoading(false);
    }
    disablePlans(false);
  }
}
async function openCheckout(plan) {
  if (!user) {
    location.assign(`/login?returnTo=${encodeURIComponent(planPath(plan))}`);
    return;
  }
  closeCheckout();
  const version = checkoutVersion;
  busy = true;
  render();
  disablePlans(true);
  try {
    showCheckoutShell(plan);
    const submit = document.querySelector("#checkout-submit");
    render();
    const data = await api("/subscription/checkout", { plan });
    if (version !== checkoutVersion) return;
    if (!data.client_secret || !data.publishable_key) throw new Error("billing_unavailable");
    checkoutEmail.disabled = false;
    cleanupCheckout = mountStripeEmbeddedCheckout({
      container: document.querySelector("#checkout-payment"), form: checkoutForm,
      submitButton: submit, statusElement: document.querySelector("#checkout-status"),
      emailInput: checkoutEmail, totalElement: document.querySelector("#checkout-total"),
      promotionInput: document.querySelector("#checkout-promotion-code"),
      promotionApply: document.querySelector("#checkout-promotion-apply"),
      promotionRemove: document.querySelector("#checkout-promotion-remove"),
      promotionStatus: document.querySelector("#checkout-promotion-status"),
      clientSecret: data.client_secret, publishableKey: data.publishable_key,
      submitLabel: submit.textContent,
      onReady: () => { if (version === checkoutVersion) setPaymentLoading(false); },
      onError: () => { if (version === checkoutVersion) setPaymentLoading(false); },
      onProcessing: (processing) => {
        checkoutProcessing = processing;
        checkoutBack.disabled = processing;
        logout.disabled = processing;
        window.dispatchEvent(new CustomEvent('checkout-processing', { detail: { processing } }));
      },
      onComplete: async (session) => {
        if (!session?.id) throw new Error("Unable to confirm your subscription. Please contact support@mainbrella.com.");
        try {
          const confirmation = await api("/subscription/complete", { session_id: session.id, client_secret: data.client_secret });
          if (version !== checkoutVersion) return;
          applySubscription(confirmation);
        } catch {
          throw new Error("Payment was submitted. We couldn’t confirm your subscription. Retry confirmation or contact support@mainbrella.com.");
        }
        if (version !== checkoutVersion) return;
        closeCheckout();
        render();
      },
    });
  } catch (error) {
    if (version !== checkoutVersion) return;
    const checkoutStatus = document.querySelector("#checkout-status");
    checkoutStatus.textContent = "Payment details are temporarily unavailable. Refresh to try again.";
    checkoutStatus.dataset.state = "error";
    setPaymentLoading(false);
    if (error.message === "subscription_exists") {
      closeCheckout();
      await refresh().catch(() => {});
    }
    message("Unable to open payment details. Refresh to try again.", true);
  } finally {
    if (version === checkoutVersion) busy = false;
    render();
  }
}
checkoutBack.addEventListener("click", () => {
  if (selectedPlan) {
    location.assign("/pricing/");
    return;
  }
  closeCheckout();
  render();
  planButtons.find((button) => !button.hidden)?.focus();
});
async function openBilling() {
  if (busy) return;
  const version = authVersion;
  busy = true;
  render();
  try {
    message(subscription ? "Opening billing…" : "Opening secure checkout…");
    const data = await api("/subscription/portal", {});
    if (version !== authVersion) return;
    const url = new URL(data.url);
    if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) {
      throw new Error("invalid_checkout_url");
    }
    location.assign(url.href);
  } catch (error) {
    if (version !== authVersion) return;
    if (error.message === "subscription_exists") {
      await refresh().catch(() => message("Unable to refresh billing. Please try again.", true));
    } else if (error.message === "not_authenticated") {
      user = null;
      subscription = null;
      subscriptionState = null;
      message("Please sign in again to continue.");
    } else {
      message("Unable to open billing. Please try again.", true);
    }
    busy = false;
    render();
  }
}
function stripeUrl(data) {
  const url = new URL(data.url);
  if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) {
    throw new Error("invalid_checkout_url");
  }
  location.assign(url.href);
}
async function changePlan(plan) {
  if (busy) return;
  const version = authVersion;
  if (!user || !subscriptionState?.active) return openBilling();
  const order = { builder: 0, pro: 1, scale: 2 };
  if (plan === subscriptionState.plan && !subscriptionState.scheduled_plan) {
    message(`${plans[plan].name} is already your current plan.`);
    return;
  }
  if (order[plan] > order[subscriptionState.plan]) {
    busy = true;
    render();
    try {
      message(`Opening secure plan change…`);
      const portal = await api("/subscription/portal", { plan });
      if (version !== authVersion) return;
      stripeUrl(portal);
    } catch (error) {
      if (version !== authVersion) return;
      message(billingError(error, "Unable to open the plan change. Please try again."), true);
      busy = false;
      render();
    }
    return;
  }
  const current = plans[subscriptionState.plan]?.name || "your current plan";
  const target = plans[plan]?.name || plan;
  const currentPrice = priceFor(subscriptionState.plan);
  const targetPrice = priceFor(plan);
  const changeText = plan === subscriptionState.plan
    ? `Cancel the scheduled change and keep ${current}?`
    : `Schedule a change from ${current} ($${currentPrice}/month) to ${target} ($${targetPrice}/month) at your next renewal? Your current plan stays active until then. Containers exceeding the new limits will stop when the change takes effect.`;
  if (!window.confirm(changeText)) return;
  busy = true;
  render();
  try {
    await api("/subscription/change", { plan, confirm: true });
    if (version !== authVersion) return;
    await refresh();
    if (version !== authVersion) return;
    message(plan === subscriptionState.plan
      ? `Scheduled plan change canceled. You’ll keep ${current}.`
      : `Your change to ${target} is scheduled for your next renewal.`);
  } catch (error) {
    if (version !== authVersion) return;
    message(billingError(error, "Unable to change your plan. Please try again."), true);
  } finally {
    if (version === authVersion) { busy = false; render(); }
  }
}
async function cancelSubscription() {
  if (busy) return;
  const version = authVersion;
  const access = subscriptionState?.active ? 'Your paid plan stays active until then. ' : '';
  if (!window.confirm(`Cancel your subscription ${periodEnd()}? ${access}Any scheduled plan change will be canceled.`)) return;
  busy = true;
  render();
  try {
    await api("/subscription/cancel", { confirm: true });
    if (version !== authVersion) return;
    await refresh();
  } catch (error) {
    if (version !== authVersion) return;
    message(billingError(error, "Unable to cancel your subscription. Please try again."), true);
  } finally {
    if (version === authVersion) { busy = false; render(); }
  }
}
async function resumeSubscription() {
  if (busy) return;
  const version = authVersion;
  busy = true;
  render();
  try {
    await api("/subscription/resume", {});
    if (version !== authVersion) return;
    await refresh();
    if (version !== authVersion) return;
    message("Your subscription will continue renewing.");
  } catch (error) {
    if (version !== authVersion) return;
    message(billingError(error, "Unable to resume your subscription. Please try again."), true);
  } finally {
    if (version === authVersion) { busy = false; render(); }
  }
}
planButtons.forEach((button) => button.addEventListener("click", async () => {
  if (busy) return;
  if (!ready) { await initialize(); if (!ready) return; }
  if (!selectedPlan) {
    location.assign(planPath(button.dataset.plan));
    return;
  }
  if (subscriptionState?.active && !subscriptionState?.trial) return changePlan(selectedPlan);
  if (subscription) return openBilling();
  return openCheckout(button.dataset.plan);
}));
manage.addEventListener("click", openBilling);
cancelButton?.addEventListener("click", cancelSubscription);
resumeButton?.addEventListener("click", resumeSubscription);
logout.addEventListener("click", async () => {
  logout.disabled = true;
  try {
    closeCheckout();
    await createAuthClient().signOut();
    user = null;
    subscription = null;
    subscriptionState = null;
    message("Signed out.");
    render();
  } catch {
    message("Unable to sign out. Please try again.", true);
  } finally {
    logout.disabled = false;
  }
});
window.addEventListener("auth-change", (event) => {
  if (event.detail?.user !== null) return;
  authVersion++;
  closeCheckout();
  user = null;
  subscription = null;
  subscriptionState = null;
  ready = Boolean(config?.configured);
  message("Signed out.");
  render();
});
if (selectedPlan) showCheckoutShell(selectedPlan);
initialize();
