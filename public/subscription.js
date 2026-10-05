const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787" : "https://api.mainbrella.com";
const subscribe = document.querySelector("#pro-subscribe");
const status = document.querySelector("#pro-status");
const account = document.querySelector("#pro-account");
const logout = document.querySelector("#pro-logout");
const signin = document.querySelector("#pro-signin");
let user = null;
let config = null;
let subscription = null;
let ready = false;
let googlePromise;

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
  subscribe.textContent = subscription ? "Manage subscription" : "Subscribe for $180/month";
  subscribe.disabled = false;
}
async function refresh() {
  const data = await api("/subscription");
  subscription = data.subscription;
  if (data.pro) {
    message(subscription.cancel_at_period_end ? "Pro is active. Your subscription ends after the current billing period." : "Your Pro subscription is active.");
  } else if (subscription) {
    message("Your subscription needs attention. Manage billing to review payment details.");
  } else {
    message("Choose Pro to start your monthly subscription.");
  }
}
async function initialize() {
  subscribe.disabled = true;
  try {
    const [configuration, session] = await Promise.all([api("/subscription/config"), api("/auth/me")]);
    config = configuration;
    user = session.user;
    if (!config.configured) throw new Error("billing_unavailable");
    ready = true;
    render();
    const params = new URLSearchParams(location.search);
    if (user && params.get("subscription_return") === "1" && params.get("session_id")) {
      message("Confirming your subscription…");
      await api("/subscription/complete", { session_id: params.get("session_id") });
      params.delete("subscription_return");
      params.delete("session_id");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    if (user) await refresh();
    else message("Sign in to subscribe to Pro.");
    if (params.get("subscription_cancelled") === "1") {
      message("Checkout canceled. You can subscribe whenever you’re ready.");
      params.delete("subscription_cancelled");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    render();
  } catch {
    ready = false;
    message("Subscriptions are temporarily unavailable. Please try again.", true);
    subscribe.textContent = "Try again";
    subscribe.disabled = false;
  }
}
async function openBilling() {
  subscribe.disabled = true;
  logout.disabled = true;
  try {
    message(subscription ? "Opening billing…" : "Opening secure checkout…");
    const data = await api(subscription ? "/subscription/portal" : "/subscription/checkout", {});
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
    render();
    logout.disabled = false;
  }
}
function loadGoogle() {
  if (!googlePromise) {
    googlePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = resolve;
      script.onerror = () => { script.remove(); googlePromise = null; reject(new Error("signin_unavailable")); };
      document.head.append(script);
    });
  }
  return googlePromise;
}
subscribe.addEventListener("click", async () => {
  if (!ready) return initialize();
  if (user) return openBilling();
  subscribe.disabled = true;
  try {
    if (!config.google_client_id) throw new Error("signin_unavailable");
    await loadGoogle();
    window.google.accounts.id.initialize({
      client_id: config.google_client_id,
      callback: async ({ credential }) => {
        signin.hidden = true;
        try {
          message("Signing in…");
          user = (await api("/auth/google", { credential })).user;
          await refresh();
          render();
          await openBilling();
        } catch {
          message("Unable to sign in. Please try again.", true);
          subscribe.disabled = false;
        }
      },
    });
    signin.hidden = false;
    signin.replaceChildren();
    window.google.accounts.id.renderButton(signin, { theme: "outline", size: "large", text: "signin_with", width: 260 });
    message("Sign in with Google to continue to checkout.");
  } catch {
    message("Google sign-in is unavailable. Please try again.", true);
  } finally {
    subscribe.disabled = false;
  }
});
logout.addEventListener("click", async () => {
  logout.disabled = true;
  try {
    await api("/auth/logout", {});
    user = null;
    subscription = null;
    signin.hidden = true;
    message("Signed out.");
    render();
  } catch {
    message("Unable to sign out. Please try again.", true);
  } finally {
    logout.disabled = false;
  }
});
initialize();
