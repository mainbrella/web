import { readConsent } from './cookie-preferences.ts';

type FunnelEvent = 'page_view' | 'landing_engaged' | 'quickstart_view' | 'quickstart_read'
  | 'cta_click' | 'sign_up' | 'login' | 'checkout_started' | 'payment_confirmed'
  | 'dashboard_view' | 'machine_started' | 'machine_returned' | 'machine_return_next_day';
type EventParameters = Record<string, string | number>;
const measurementId = import.meta.env?.VITE_GA_MEASUREMENT_ID || '';
const attributionKey = 'mainbrella-acquisition';
const attributionLifetime = 30 * 86_400_000;
let configured = false;
let accountId: string | null = null;
let memoryAttribution: { at: number; entry: string; campaign: EventParameters; clickids?: EventParameters } | null = null;
const clickIdKeys = ['gclid', 'fbclid', 'msclkid', 'ttclid'] as const;

// Keep arbitrary query strings, credentials, emails and prompts out of analytics.
export function campaignParameters(url: URL): EventParameters {
  const parameters: EventParameters = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'creator']) {
    const value = url.searchParams.get(key);
    if (value && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) parameters[key] = value;
  }
  return parameters;
}

export function publicPage(url: URL): string {
  return url.origin + url.pathname;
}

export function returnEvents(firstDay: number, today: number): FunnelEvent[] {
  if (today <= firstDay) return [];
  return today === firstDay + 1 ? ['machine_returned', 'machine_return_next_day'] : ['machine_returned'];
}

function enabled() {
  return /^G-[A-Z0-9]+$/.test(measurementId) && typeof window !== 'undefined' && readConsent() === 'accepted';
}

export function syncFunnelConsent() {
  if (!/^G-[A-Z0-9]+$/.test(measurementId) || typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = readConsent() !== 'accepted';
}

function stored(storage: Storage, key: string) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

function remember(storage: Storage, key: string, value: unknown) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Tracking must not block the product. */ }
}

function attribution(): EventParameters {
  const now = Date.now();
  const current = campaignParameters(new URL(window.location.href));
  let previous = memoryAttribution;
  try { previous = stored(window.localStorage, attributionKey) || previous; } catch { /* Memory fallback. */ }
  const valid = previous && Number.isFinite(previous.at) && previous.at <= now
    && now - previous.at < attributionLifetime && typeof previous.entry === 'string';
  const clickids: EventParameters = {};
  for (const key of clickIdKeys) {
    const value = new URL(window.location.href).searchParams.get(key);
    if (value && /^[a-zA-Z0-9_-]{1,256}$/.test(value)) clickids[key] = value;
  }
  const entry = valid && previous ? previous : { at: now, entry: window.location.pathname, campaign: current, clickids };
  memoryAttribution = entry;
  if (!valid) { try { remember(window.localStorage, attributionKey, entry); } catch { /* Memory fallback. */ } }
  // Revalidate persisted values rather than trusting browser storage as event data.
  const campaign = new URL('https://mainbrella.com');
  for (const [key, value] of Object.entries(entry.campaign || {})) {
    if (typeof value === 'string') campaign.searchParams.set(key, value);
  }
  const entryPage = /^\/(?!\/)[A-Za-z0-9/_-]{0,299}$/.test(entry.entry) ? entry.entry : '/';
  return { entry_page: entryPage, ...campaignParameters(campaign) };
}

// A backend acquisition record needs the same first-touch campaign as analytics,
// plus click identifiers that must never be sent to GA or included in a URL.
export function firstTouchAttribution() {
  if (typeof window === 'undefined' || readConsent() !== 'accepted') return null;
  try {
    const values = attribution();
    let saved = memoryAttribution;
    try { saved = stored(window.localStorage, attributionKey) || saved; } catch { /* Getter blocked; the in-memory first touch is enough. */ }
    const clickids: EventParameters = {};
    for (const key of clickIdKeys) {
      const value = saved?.clickids?.[key];
      if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value)) clickids[key] = value;
    }
    return { entryPage: String(values.entry_page || '/'), campaign: { ...campaignParametersFrom(values), ...clickids } };
  } catch { return null; }
}

function campaignParametersFrom(values: EventParameters) {
  const campaign: EventParameters = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'creator']) {
    const value = values[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) campaign[key] = value;
  }
  return campaign;
}

function configure() {
  if (configured) return;
  syncFunnelConsent();
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  let referrer = '';
  try { referrer = publicPage(new URL(document.referrer)); } catch { /* Direct arrival. */ }
  window.gtag('config', measurementId, {
    send_page_view: false, page_location: publicPage(new URL(window.location.href)),
    page_referrer: referrer, user_id: accountId,
    allow_google_signals: false, allow_ad_personalization_signals: false,
    // Acquisition reports use our allowlisted campaign values, not raw URLs.
    ignore_referrer: referrer.startsWith(window.location.origin + '/'),
  });
  if (!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
  }
  configured = true;
}

export function identifyAccount(id: string | null) {
  accountId = id;
  if (!enabled()) return;
  try {
    configure();
    window.gtag('config', measurementId, { user_id: id, send_page_view: false });
  } catch { /* Optional measurement must not interrupt authentication. */ }
}

export function trackFunnel(event: FunnelEvent, parameters: EventParameters = {}) {
  if (!enabled()) return;
  try {
    configure();
    window.gtag('event', event, {
      ...attribution(), ...parameters, send_to: measurementId,
      page_location: publicPage(new URL(window.location.href)), page_path: window.location.pathname,
      transport_type: 'beacon',
    });
  } catch { /* Blocked storage/scripts must never interrupt login, payment or creation. */ }
}

export function trackConfirmedPayment(sessionId: string, plan: string) {
  if (!enabled()) return;
  try {
    const key = 'mainbrella-confirmed-checkouts';
    const saved = stored(window.sessionStorage, key);
    const completed: string[] = Array.isArray(saved) ? saved.filter(value => typeof value === 'string') : [];
    if (completed.includes(sessionId)) return;
    trackFunnel('payment_confirmed', { plan });
    remember(window.sessionStorage, key, [...completed.slice(-49), sessionId]);
  } catch { /* Optional measurement. */ }
}

export function trackMachineStart(size: string) {
  if (!enabled()) return;
  trackFunnel('machine_started', { size });
  if (!accountId) return;
  try {
    const key = `mainbrella-machine-days:${accountId}`;
    const previous = stored(window.localStorage, key);
    const today = Math.floor(Date.now() / 86_400_000);
    const firstDay = Number.isInteger(previous?.firstDay) && previous.firstDay <= today ? previous.firstDay : today;
    if (previous?.lastDay !== today) {
      for (const event of returnEvents(firstDay, today)) trackFunnel(event);
    }
    remember(window.localStorage, key, { firstDay, lastDay: today });
  } catch { /* Browser-local repeat-use measurement is best effort. */ }
}
