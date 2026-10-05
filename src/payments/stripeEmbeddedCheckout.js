import { loadStripe } from "@stripe/stripe-js";

const stripePromiseCache = new Map();

const CHECKOUT_APPEARANCE = {
  theme: "night",
  inputs: "spaced",
  labels: "above",
  variables: {
    colorPrimary: "#ffad70",
    colorBackground: "#111315",
    colorText: "#e7e9ec",
    colorDanger: "#ef9a88",
    colorSuccess: "#a8d8a5",
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontSizeBase: "16px",
    spacingUnit: "4px",
    borderRadius: "4px",
    focusBoxShadow: "0 0 0 2px rgba(255, 173, 112, 0.32)",
    accessibleColorOnColorPrimary: "#111315",
  },
  rules: {
    ".Block": {
      backgroundColor: "#111315",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: "none",
    },
    ".Input": {
      backgroundColor: "rgba(255, 255, 255, 0.045)",
      border: "1px solid rgba(231, 233, 236, 0.2)",
      boxShadow: "none",
      color: "#e7e9ec",
    },
    ".Input::placeholder": { color: "#7f858d" },
    ".Label": { color: "#a1a6ad", fontWeight: "700" },
    ".Tab": {
      backgroundColor: "rgba(255, 255, 255, 0.045)",
      border: "1px solid rgba(231, 233, 236, 0.1)",
      boxShadow: "none",
    },
    ".Tab--selected": {
      borderColor: "#ffad70",
      boxShadow: "0 0 0 1px rgba(255, 173, 112, 0.22)",
    },
    ".TabLabel": { color: "#e7e9ec" },
    ".Error": { color: "#ef9a88" },
    ".CheckboxLabel": { color: "#c7cbd0" },
  },
};

const PAYMENT_ELEMENT_OPTIONS = {
  paymentMethodOrder: ["card"],
  wallets: { link: "never", applePay: "never", googlePay: "never" },
  layout: { type: "accordion", radios: "always" },
};

function getStripePromise(publishableKey) {
  const key = typeof publishableKey === "string" ? publishableKey.trim() : "";
  if (!key) return null;
  if (!stripePromiseCache.has(key)) stripePromiseCache.set(key, loadStripe(key));
  return stripePromiseCache.get(key);
}

function setStatus(statusElement, message, state = "") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

export function mountStripeEmbeddedCheckout({
  container,
  form,
  submitButton,
  statusElement,
  clientSecret,
  publishableKey,
  submitLabel = "Subscribe for $9.99/month",
  emailInput,
  totalElement,
  onProcessing,
  onComplete,
  onError,
}) {
  let destroyed = false;
  let checkoutActions = null;
  let paymentElement = null;
  let processing = false;

  submitButton.disabled = true;
  setStatus(statusElement, "Loading payment form…", "pending");

  async function initialize() {
    try {
      const stripePromise = getStripePromise(publishableKey);
      if (!stripePromise) throw new Error("Stripe publishable key is missing.");
      const stripe = await stripePromise;
      if (!stripe || typeof stripe.initCheckoutElementsSdk !== "function") {
        throw new Error("Stripe checkout is unavailable.");
      }

      const checkout = stripe.initCheckoutElementsSdk({
        clientSecret,
        elementsOptions: { appearance: CHECKOUT_APPEARANCE },
      });
      const loadResult = await checkout.loadActions();
      if (destroyed) return;
      if (loadResult?.type !== "success") {
        throw new Error(loadResult?.error?.message || "Unable to load the payment form.");
      }

      checkoutActions = loadResult.actions;
      const syncSession = (session) => {
        if (destroyed) return;
        if (session?.total?.total?.amount) totalElement.textContent = `Due today: ${session.total.total.amount}`;
        submitButton.disabled = processing || session?.canConfirm !== true;
      };
      if (typeof checkout.on === "function") checkout.on("change", syncSession);

      paymentElement = checkout.createPaymentElement(PAYMENT_ELEMENT_OPTIONS);
      paymentElement.on?.("loaderror", (event) => {
        if (destroyed) return;
        const message = event?.error?.message || "Unable to load the payment form.";
        submitButton.disabled = true;
        setStatus(statusElement, message, "error");
        onError?.(message);
      });
      paymentElement.mount(container);
      syncSession(checkoutActions.getSession?.());
      setStatus(statusElement, "", "");
    } catch (error) {
      if (destroyed) return;
      const message = error?.message || "Unable to load the payment form.";
      submitButton.disabled = true;
      setStatus(statusElement, message, "error");
      onError?.(message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (destroyed || !checkoutActions) {
      setStatus(statusElement, "Payment form is still loading.", "error");
      return;
    }
    if (processing || !form.reportValidity()) return;
    processing = true;
    onProcessing?.(true);
    submitButton.disabled = true;
    submitButton.textContent = "Processing…";
    setStatus(statusElement, "Processing payment…", "pending");
    try {
      const result = await checkoutActions.confirm({ redirect: "if_required", email: emailInput.value.trim() });
      if (result?.type === "error") {
        throw new Error(result.error?.message || "Unable to activate subscription.");
      }
      if (destroyed) return;
      await onComplete?.(result?.session || checkoutActions.getSession?.());
    } catch (error) {
      if (destroyed) return;
      const message = error?.message || "Unable to activate subscription.";
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
      setStatus(statusElement, message, "error");
      onError?.(message);
    } finally {
      processing = false;
      onProcessing?.(false);
    }
  }

  form.addEventListener("submit", handleSubmit);
  initialize();

  return () => {
    destroyed = true;
    form.removeEventListener("submit", handleSubmit);
    paymentElement?.destroy?.();
    paymentElement = null;
    checkoutActions = null;
    container.replaceChildren();
  };
}
