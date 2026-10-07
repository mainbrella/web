import type { User } from './types.ts';

type GoogleIdentity = {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; context: string; ux_mode: string }): void;
  renderButton(host: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; logo_alignment: string; width: number }): void;
  disableAutoSelect(): void;
};
type PixelQueue = ((...args: unknown[]) => void) & { q: IArguments[] };

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
    dataLayer: IArguments[];
    gtag: (...args: unknown[]) => void;
    oaiq: PixelQueue;
    clarity: PixelQueue;
    _tfa: { notify: string; name: string; id: number }[];
  }
  interface WindowEventMap {
    'auth-change': CustomEvent<{ user: User | null }>;
    'checkout-processing': CustomEvent<{ processing: boolean }>;
    'cookie-consent-change': CustomEvent<{ choice: 'accepted' | 'rejected' }>;
  }
}
