import type { User } from './types.ts';
import { needsSignInCookies, signInCookieMessage } from './cookie-preferences.ts';
import { identifyAccount, trackFunnel } from './acquisition-analytics.ts';
import { API_ORIGIN } from './api-origin.ts';
import { clearAcquisitionTokens, linkPendingAcquisition } from './acquisition-spine.ts';

export const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID
  || "854186419005-l0u2olqlqe40qmgin0q8tjpvftooi6ac.apps.googleusercontent.com";
export { API_ORIGIN } from './api-origin.ts';

export function createAuthClient() {
  async function request(path: string, options: RequestInit = {}) {
    let response;
    try {
      response = await fetch(`${API_ORIGIN}${path}`, {
        credentials: "include",
        headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
        ...options,
      });
    } catch {
      throw new Error("Could not reach Mainbrella sign-in. Check your connection and try again.");
    }
    const result = await response.json().catch(() => null);
    return { response, result };
  }

  return {
    async readSession(): Promise<{ user: User } | null> {
      if (needsSignInCookies()) return null;
      const { response, result } = await request("/auth/me");
      if (response.status === 401) return null;
      if (!response.ok || !result || !("user" in result)) throw new Error("Could not check your sign-in. Please try again.");
      identifyAccount(result.user?.id || null);
      if (result.user) void linkPendingAcquisition(result.user.id);
      return result.user ? { user: result.user } : null;
    },
    async signInWithGoogle(credential?: string): Promise<{ user: User }> {
      if (needsSignInCookies()) throw new Error(signInCookieMessage);
      if (!credential) throw new Error("Google sign-in could not be completed. Please try again.");
      const { response, result } = await request("/auth/google", {
        method: "POST", body: JSON.stringify({ credential }),
      });
      if (!response.ok || !result?.user) {
        throw new Error(result?.error === "identity_conflict"
          ? "This email already has a password account. Continue with email and password."
          : result?.error === "invalid_google_credential"
          ? "Google could not verify that sign-in. Please try again."
          : "Could not finish signing you in. Please try again.");
      }
      identifyAccount(result.user.id);
      void linkPendingAcquisition(result.user.id);
      trackFunnel('login', { method: 'google' });
      if (result.created === true) trackFunnel('sign_up', { method: 'google' });
      return { user: result.user };
    },
    async signInWithEmail(email: string, password: string): Promise<{ user: User }> {
      if (needsSignInCookies()) throw new Error(signInCookieMessage);
      const { response, result } = await request("/auth/email", {
        method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!response.ok || !result?.user) {
        const messages: Record<string, string> = {
          invalid_request: "Enter a valid email and a password of no more than 128 characters.",
          weak_password: "Use at least 8 characters for a new password.",
          invalid_credentials: "Email or password is incorrect. If you signed up with Google, continue with Google.",
          rate_limited: "Too many attempts. Please wait a minute and try again.",
        };
        throw new Error(messages[result?.error] || "Could not finish signing you in. Please try again.");
      }
      identifyAccount(result.user.id);
      void linkPendingAcquisition(result.user.id);
      trackFunnel('login', { method: 'email' });
      if (result.created === true) trackFunnel('sign_up', { method: 'email' });
      return { user: result.user };
    },
    async signOut() {
      const { response, result } = await request("/auth/logout", { method: "POST" });
      if (!response.ok || result?.ok !== true) throw new Error("Could not sign you out. Please try again.");
      identifyAccount(null);
      clearAcquisitionTokens();
      window.google?.accounts?.id?.disableAutoSelect();
      window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: null } }));
    },
  };
}
