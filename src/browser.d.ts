import type { User, PrepaidBalance } from './types.ts';

type GoogleIdentity = {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; context: string; ux_mode: string }): void;
  renderButton(host: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; logo_alignment: string; width: number }): void;
  disableAutoSelect(): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
  interface WindowEventMap {
    'auth-change': CustomEvent<{ user: User | null }>;
    'checkout-processing': CustomEvent<{ processing: boolean }>;
    'billing-balance-change': CustomEvent<{ userId: string; balance?: PrepaidBalance }>;
  }
}
