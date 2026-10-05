import { mountStripeEmbeddedCheckout } from "./payments/stripeEmbeddedCheckout.js";
import { API_ORIGIN, createAuthClient } from "./auth.js";
import { plans } from "./plans.js";
const apiOrigin = API_ORIGIN;
const planButtons = [...document.querySelectorAll("[data-plan]")];
const manage = document.querySelector("#billing-manage");
const routeSlug = location.pathname.match(/^\/pricing\/([^/]+)\/?$/)?.[1];
const selectedPlan = Object.hasOwn(plans, routeSlug) ? routeSlug : null;
const planPath = (plan) => `/pricing/${plan}`;
if (selectedPlan) {
  document.title = `${plans[selectedPlan].name} subscription · Mainbrella`;
  document.querySelector("#plan-title").textContent = `${plans[selectedPlan].name} — $${plans[selectedPlan].price}/month`;
  planButtons.forEach((button) => { button.dataset.plan = selectedPlan; });
}
const checkoutView = document.querySelector("#inline-checkout");
const checkoutForm = document.querySelector("#checkout-form");
const checkoutEmail = document.querySelector("#checkout-email");
const checkoutBack = document.querySelector("#checkout-back");
let cleanupCheckout;
let checkoutVersion = 0;
let busy = false;
let guestSubscribed = false;
function closeCheckout() {
  checkoutVersion++;
  busy = false;
  cleanupCheckout?.();
  cleanupCheckout = null;
  checkoutView.hidden = true;
  checkoutForm.hidden = true;
  document.querySelector("#checkout-total").textContent = "";
  document.querySelector("#pricing-plans").hidden = false;
}
function disablePlans(disabled) {
  planButtons.forEach((button) => { button.disabled = disabled; });
}
const status = document.querySelector("#pro-status");
const account = document.querySelector("#pro-account");
const logout = document.querySelector("#pro-logout");
const login = document.querySelector("#pro-login");
if (selectedPlan) login.href = `/login?returnTo=${encodeURIComponent(planPath(selectedPlan))}`;
let user = null;
let config = null;
let subscription = null;
let ready = false;

async function api(path, body) {
  const response = await fetch(apiOrigin + path, {
    credentials: "include",
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
function render() {
  account.hidden = !user;
  account.textContent = user ? `Signed in as ${user.email || user.name}` : "";
  logout.hidden = !user;
  login.hidden = Boolean(user) || !checkoutView.hidden;
  manage.hidden = !subscription;
  planButtons.forEach((button) => {
    button.hidden = Boolean(subscription) || guestSubscribed;
    button.disabled = busy;
  });
}
async function refresh() {
  const data = await api("/subscription");
  subscription = data.subscription;
  if (data.active) {
    const name = plans[data.plan]?.name || "Your plan";
    message(subscription.cancel_at_period_end ? `${name} is active. Your subscription ends after the current billing period.` : `Your ${name} subscription is active.`);
  } else if (subscription) {
    message("Your subscription needs attention. Manage billing to review payment details.");
  } else {
    message("Choose a plan to start your monthly subscription.");
  }
}
async function initialize() {
  disablePlans(true);
  try {
    const [configuration, session] = await Promise.all([api("/subscription/config"), api("/auth/me").catch(() => ({ user: null }))]);
    config = configuration;
    user = session.user;
    if (!config.configured) throw new Error("billing_unavailable");
    ready = true;
    render();
    if (selectedPlan && !user) {
      location.assign(`/login?returnTo=${encodeURIComponent(planPath(selectedPlan))}`);
      return;
    }
    const params = new URLSearchParams(location.search);
    const returningFromCheckout = params.has("subscription_return") || params.has("subscription_cancelled");
    if (user && params.get("subscription_return") === "1" && params.get("session_id")) {
      message("Confirming your subscription…");
      await api("/subscription/complete", { session_id: params.get("session_id") });
      params.delete("subscription_return");
      params.delete("session_id");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    if (user) await refresh();
    else message("Sign in to subscribe.");
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
    render();
    if (selectedPlan && user && !subscription && !returningFromCheckout) await openCheckout(selectedPlan);
  } catch {
    ready = false;
    message("Subscriptions are temporarily unavailable. Please try again.", true);
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
  disablePlans(true);
  const details = plans[plan];
  try {
    checkoutView.hidden = false;
    document.querySelector("#pricing-plans").hidden = true;
    const title = document.querySelector("#checkout-title");
    title.textContent = `${details.name} — $${details.price}/month`;
    title.focus();
    document.querySelector("#checkout-summary").textContent = "Preparing secure payment…";
    const data = await api("/subscription/checkout", { plan });
    if (version !== checkoutVersion) return;
    if (!data.client_secret || !data.publishable_key) throw new Error("billing_unavailable");
    document.querySelector("#checkout-summary").textContent = "Enter your payment details below. Usage billing is not yet enabled.";
    checkoutEmail.value = user?.email || "";
    checkoutEmail.readOnly = false;
    checkoutForm.hidden = false;
    const submit = document.querySelector("#checkout-submit");
    submit.textContent = `Subscribe for $${details.price}/month`;
    cleanupCheckout = mountStripeEmbeddedCheckout({
      container: document.querySelector("#checkout-payment"), form: checkoutForm,
      submitButton: submit, statusElement: document.querySelector("#checkout-status"),
      emailInput: checkoutEmail, totalElement: document.querySelector("#checkout-total"),
      clientSecret: data.client_secret, publishableKey: data.publishable_key,
      submitLabel: submit.textContent,
      onProcessing: (processing) => {
        checkoutBack.disabled = processing;
        logout.disabled = processing;
        window.dispatchEvent(new CustomEvent('checkout-processing', { detail: { processing } }));
      },
      onComplete: async (session) => {
        if (!session?.id) throw new Error("Unable to confirm your subscription. Please contact support@mainbrella.com.");
        let result;
        try {
          result = await api("/subscription/complete", { session_id: session.id, client_secret: data.client_secret });
        } catch {
          throw new Error("Payment was submitted. We couldn’t confirm your subscription. Retry confirmation or contact support@mainbrella.com.");
        }
        if (version !== checkoutVersion) return;
        if (!user) guestSubscribed = true;
        closeCheckout();
        render();
        if (user) { await refresh(); render(); }
        else message(result.active ? `Your ${details.name} subscription is active. A receipt will be sent to your email. Contact support@mainbrella.com to manage billing.` : "Payment is being reviewed. Contact support@mainbrella.com for help.");
      },
    });
  } catch (error) {
    if (version !== checkoutVersion) return;
    closeCheckout();
    if (error.message === "subscription_exists") await refresh().catch(() => {});
    message("Unable to open payment details. Please try again.", true);
  } finally {
    if (version === checkoutVersion) busy = false;
    render();
  }
}
checkoutBack.addEventListener("click", () => {
  if (selectedPlan) {
    location.assign("/#pricing");
    return;
  }
  closeCheckout();
  render();
  planButtons.find((button) => !button.hidden)?.focus();
});
async function openBilling() {
  busy = true;
  manage.disabled = true;
  disablePlans(true);
  logout.disabled = true;
  try {
    message(subscription ? "Opening billing…" : "Opening secure checkout…");
    const data = await api("/subscription/portal", {});
    const url = new URL(data.url);
    if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) {
      throw new Error("invalid_checkout_url");
    }
    location.assign(url.href);
  } catch (error) {
    if (error.message === "subscription_exists") {
      await refresh().catch(() => message("Unable to refresh billing. Please try again.", true));
    } else if (error.message === "not_authenticated") {
      user = null;
      subscription = null;
      message("Please sign in again to continue.");
    } else {
      message("Unable to open billing. Please try again.", true);
    }
    busy = false;
    manage.disabled = false;
    render();
    logout.disabled = false;
  }
}
planButtons.forEach((button) => button.addEventListener("click", async () => {
  if (!ready) { await initialize(); if (!ready) return; }
  if (!selectedPlan) {
    location.assign(planPath(button.dataset.plan));
    return;
  }
  return openCheckout(button.dataset.plan);
}));
manage.addEventListener("click", openBilling);
logout.addEventListener("click", async () => {
  logout.disabled = true;
  try {
    closeCheckout();
    await createAuthClient().signOut();
    user = null;
    subscription = null;
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
  closeCheckout();
  user = null;
  subscription = null;
  message("Signed out.");
  render();
});
initialize();
