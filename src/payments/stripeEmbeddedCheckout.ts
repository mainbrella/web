import type { Appearance, Stripe, StripePaymentElement, StripeCheckoutSession, StripeCheckoutLoadActionsSuccess, StripeCheckoutPaymentElementOptions } from '@stripe/stripe-js';
interface CheckoutOptions {
  container: HTMLElement; form: HTMLFormElement; submitButton: HTMLButtonElement; statusElement: HTMLElement;
  clientSecret: string; publishableKey: string; submitLabel: string; emailInput: HTMLInputElement; totalElement: HTMLElement;
  promotionInput?: HTMLInputElement | null; promotionApply?: HTMLButtonElement | null; promotionRemove?: HTMLButtonElement | null; promotionStatus?: HTMLElement | null;
  onProcessing?: (processing: boolean) => void; onComplete?: (session: StripeCheckoutSession) => Promise<void>;
  onError?: (message: string) => void; onReady?: () => void;
}
// Load Stripe only when a visitor opens checkout. The default entry point injects it on import.
import { loadStripe } from "@stripe/stripe-js/pure";

const stripePromiseCache = new Map<string, Promise<Stripe | null>>();

const CHECKOUT_APPEARANCE: Appearance = {
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

const PAYMENT_ELEMENT_OPTIONS: StripeCheckoutPaymentElementOptions = {
  paymentMethodOrder: ["card"],
  wallets: { link: "never", applePay: "never", googlePay: "never" },
  layout: { type: "accordion", radios: "always" },
};

function getStripePromise(publishableKey: string) {
  const key = typeof publishableKey === "string" ? publishableKey.trim() : "";
  if (!key) return null;
  if (!stripePromiseCache.has(key)) stripePromiseCache.set(key, loadStripe(key));
  return stripePromiseCache.get(key);
}

function setStatus(statusElement: HTMLElement | null | undefined, message: string, state = "") {
  if (!statusElement) return;
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
  submitLabel,
  emailInput,
  totalElement,
  promotionInput,
  promotionApply,
  promotionRemove,
  promotionStatus,
  onProcessing,
  onComplete,
  onError,
  onReady,
}: CheckoutOptions) {
  let destroyed = false;
  let checkoutActions: StripeCheckoutLoadActionsSuccess | null = null;
  let paymentElement: StripePaymentElement | null = null;
  let processing = false;
  let emailTimer: ReturnType<typeof setTimeout> | undefined;
  let syncSession: (session: StripeCheckoutSession) => void = () => {};
  let syncedEmail = "";
  let fixedEmail = false;
  let confirmedSession: StripeCheckoutSession | null = null;
  let updatingPromotion = false;

  if (promotionInput) promotionInput.value = "";
  if (promotionStatus) setStatus(promotionStatus, "");

  submitButton.disabled = true;
  setStatus(statusElement, "Loading payment form…", "pending");

  async function initialize() {
    try {
      const stripePromise = getStripePromise(publishableKey);
      if (!stripePromise) throw new Error("Stripe publishable key is missing.");
      const stripe = await stripePromise;
      if (destroyed) return;
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
      const sessionEmail = checkoutActions.getSession()?.email;
      // A Customer email supplied by the backend is fixed by Stripe for this
      // session. Display Stripe's value without attempting to update it.
      fixedEmail = Boolean(sessionEmail);
      if (fixedEmail) emailInput.value = sessionEmail!;
      emailInput.readOnly = fixedEmail;
      syncSession = (session) => {
        if (destroyed) return;
        if (session?.total?.total?.amount) totalElement.textContent = `Due today: ${session.total.total.amount}`;
        submitButton.disabled = processing || updatingPromotion || (!confirmedSession && ((!fixedEmail && syncedEmail !== emailInput.value.trim()) || !emailInput.validity.valid || session?.canConfirm !== true));
        const promotionLocked = processing || updatingPromotion || Boolean(confirmedSession);
        if (promotionInput) promotionInput.disabled = promotionLocked;
        if (promotionApply) promotionApply.disabled = promotionLocked || !promotionInput?.value.trim();
        if (promotionRemove) {
          promotionRemove.disabled = promotionLocked;
          promotionRemove.hidden = !session?.discountAmounts?.some(discount => discount.promotionCode);
        }
      };
      if (typeof checkout.on === "function") checkout.on("change", syncSession);

      paymentElement = checkout.createPaymentElement(PAYMENT_ELEMENT_OPTIONS);
      paymentElement.on?.("ready", () => {
        if (destroyed) return;
        if (statusElement.dataset.state === "pending") setStatus(statusElement, "");
        onReady?.();
      });
      paymentElement.on?.("loaderror", (event) => {
        if (destroyed) return;
        const message = event?.error?.message || "Unable to load the payment form.";
        submitButton.disabled = true;
        setStatus(statusElement, message, "error");
        onError?.(message);
      });
      paymentElement.mount(container);
      syncSession(checkoutActions.getSession?.());
      if (!fixedEmail && emailInput.value) await updateEmail();
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unexpected error");
      if (destroyed) return;
      const message = error?.message || "Unable to load the payment form.";
      submitButton.disabled = true;
      setStatus(statusElement, message, "error");
      onError?.(message);
    }
  }

  async function updateEmail() {
    const email = emailInput.value.trim();
    if (destroyed || fixedEmail || !checkoutActions || !emailInput.validity.valid) return;
    try {
      const result = await checkoutActions.updateEmail(email);
      if (destroyed || email !== emailInput.value.trim()) return;
      if (result.type === "error") throw new Error(result.error.message);
      syncedEmail = email;
      syncSession(checkoutActions.getSession());
      setStatus(statusElement, "");
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unexpected error");
      if (destroyed) return;
      setStatus(statusElement, error?.message || "Unable to update your email. Please try again.", "error");
    }
  }
  function handleEmailInput() {
    if (fixedEmail) return;
    submitButton.disabled = true;
    clearTimeout(emailTimer);
    emailTimer = setTimeout(updateEmail, 300);
  }

  function handlePromotionInput() {
    if (checkoutActions) syncSession(checkoutActions.getSession());
  }
  async function updatePromotion(remove = false) {
    if (destroyed || !checkoutActions || processing || updatingPromotion || confirmedSession) return;
    const code = promotionInput?.value.trim();
    if (!remove && !code) return;
    updatingPromotion = true;
    syncSession(checkoutActions.getSession());
    setStatus(promotionStatus, remove ? "Removing code…" : "Applying code…", "pending");
    try {
      const result = remove ? await checkoutActions.removePromotionCode() : await checkoutActions.applyPromotionCode(code!);
      if (destroyed) return;
      if (result?.type === "error") throw new Error(result.error?.message || "Unable to update the promotion code.");
      if (remove && promotionInput) promotionInput.value = "";
      setStatus(promotionStatus, remove ? "Promotion code removed." : "Promotion code applied.");
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unexpected error");
      if (!destroyed) setStatus(promotionStatus, error?.message || "Unable to update the promotion code. Please try again.", "error");
    } finally {
      updatingPromotion = false;
      if (!destroyed) syncSession(checkoutActions.getSession());
    }
  }
  const handlePromotionApply = () => updatePromotion();
  const handlePromotionRemove = () => updatePromotion(true);
  function handlePromotionKey(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    updatePromotion();
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (destroyed || !checkoutActions) {
      setStatus(statusElement, "Payment form is still loading.", "error");
      return;
    }
    if (processing || updatingPromotion || !form.reportValidity()) return;
    if (!confirmedSession && (checkoutActions.getSession()?.canConfirm !== true
      || (!fixedEmail && syncedEmail !== emailInput.value.trim()))) return;
    processing = true;
    syncSession(checkoutActions.getSession());
    onProcessing?.(true);
    submitButton.disabled = true;
    submitButton.textContent = "Processing…";
    setStatus(statusElement, "Processing payment…", "pending");
    try {
      if (!confirmedSession) {
        const result = await checkoutActions.confirm({
          redirect: "if_required",
          ...(!fixedEmail ? { email: emailInput.value.trim() } : {}),
        });
        if (destroyed) return;
        if (result?.type === "error") {
          throw new Error(result.error?.message || "Unable to complete payment.");
        }
        confirmedSession = result?.session || checkoutActions.getSession?.();
        emailInput.readOnly = true;
      }
      if (destroyed) return;
      await onComplete?.(confirmedSession);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unexpected error");
      if (destroyed) return;
      const message = error?.message || "Unable to complete payment.";
      submitButton.disabled = false;
      submitButton.textContent = confirmedSession ? "Retry confirmation" : submitLabel;
      setStatus(statusElement, message, "error");
      onError?.(message);
    } finally {
      processing = false;
      if (!destroyed) syncSession(checkoutActions!.getSession());
      onProcessing?.(false);
    }
  }

  emailInput.addEventListener("input", handleEmailInput);
  form.addEventListener("submit", handleSubmit);
  promotionInput?.addEventListener("input", handlePromotionInput);
  promotionInput?.addEventListener("keydown", handlePromotionKey);
  promotionApply?.addEventListener("click", handlePromotionApply);
  promotionRemove?.addEventListener("click", handlePromotionRemove);
  initialize();

  return () => {
    destroyed = true;
    clearTimeout(emailTimer);
    emailInput.removeEventListener("input", handleEmailInput);
    form.removeEventListener("submit", handleSubmit);
    promotionInput?.removeEventListener("input", handlePromotionInput);
    promotionInput?.removeEventListener("keydown", handlePromotionKey);
    promotionApply?.removeEventListener("click", handlePromotionApply);
    promotionRemove?.removeEventListener("click", handlePromotionRemove);
    paymentElement?.destroy?.();
    paymentElement = null;
    checkoutActions = null;
    container.replaceChildren();
  };
}
