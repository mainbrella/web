// Load Stripe only when a visitor opens checkout. The default entry point injects it on import.
import { loadStripe } from "@stripe/stripe-js/pure";

const stripePromiseCache = new Map();

function getStripePromise(publishableKey) {
  const key = typeof publishableKey === "string" ? publishableKey.trim() : "";
  if (!key) return null;
  if (!stripePromiseCache.has(key)) stripePromiseCache.set(key, loadStripe(key));
  return stripePromiseCache.get(key);
}

export function mountStripeEmbeddedCheckout({
  container, statusElement, clientSecret, publishableKey, onError, onReady,
}) {
  let destroyed = false;
  let embeddedCheckout = null;
  statusElement.textContent = "Loading payment form…";
  statusElement.dataset.state = "pending";

  async function initialize() {
    try {
      const stripePromise = getStripePromise(publishableKey);
      if (!stripePromise) throw new Error("Stripe publishable key is missing.");
      const stripe = await stripePromise;
      if (destroyed) return;
      // Support the legacy method on Stripe.js versions preceding the rename.
      const createCheckout = stripe?.createEmbeddedCheckoutPage || stripe?.initEmbeddedCheckout;
      if (typeof createCheckout !== "function") throw new Error("Stripe checkout is unavailable.");
      const checkout = await createCheckout.call(stripe, {
        fetchClientSecret: async () => clientSecret,
      });
      if (destroyed) {
        checkout.destroy();
        return;
      }
      embeddedCheckout = checkout;
      checkout.mount(container);
      statusElement.textContent = "";
      statusElement.dataset.state = "";
      onReady?.();
      // Stripe owns email, totals, promotion codes, and submission. Completion
      // redirects to the session's return_url for account-owned verification.
    } catch (error) {
      if (destroyed) return;
      const message = error?.message || "Unable to load the payment form.";
      statusElement.textContent = message;
      statusElement.dataset.state = "error";
      onError?.(message);
    }
  }

  initialize();
  return () => {
    destroyed = true;
    embeddedCheckout?.destroy();
    embeddedCheckout = null;
    container.replaceChildren();
  };
}
