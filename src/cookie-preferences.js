const consentKey = 'mainbrella-cookie-consent';
let rememberedChoice = null;

export function readConsent() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const choice = window[storageName]?.getItem(consentKey);
      if (choice === 'accepted' || choice === 'rejected') return choice;
    } catch {
      // Storage can be blocked; use this page's choice as a last resort.
    }
  }
  return rememberedChoice;
}

export function saveConsent(choice) {
  if (choice !== 'accepted' && choice !== 'rejected') return;
  let saved = false;
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName];
      if (storage) {
        storage.setItem(consentKey, choice);
        saved = true;
      }
    } catch {
      // Keep the choice in any available storage, without using a cookie.
    }
  }
  rememberedChoice = saved ? null : choice;
}

export function needsSignInCookies() {
  return readConsent() !== 'accepted';
}

export const signInCookieMessage = 'Sign-in and account features require cookies. Change your cookie choice to continue, or keep browsing without signing in.';
