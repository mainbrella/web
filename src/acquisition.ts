import './cookie-consent.ts';
import { readConsent } from './cookie-preferences.ts';
import { syncFunnelConsent, trackFunnel } from './acquisition-analytics.ts';

const landingPages = ['/', '/e2b-alternative/', '/daytona-alternative/', '/cloudflare-sandbox/'];
const path = location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
const landing = landingPages.includes(path);
const quickstart = path === '/docs/';
let started = false;
let visibleMs = 0;
let since = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function pause() {
  if (since) visibleMs += performance.now() - since;
  since = 0;
  clearTimeout(timer);
}

function resume() {
  if (readConsent() !== 'accepted' || document.visibilityState !== 'visible' || since || visibleMs >= 10_000) return;
  since = performance.now();
  timer = setTimeout(() => {
    pause();
    visibleMs = 10_000;
    if (readConsent() === 'accepted') trackFunnel(quickstart ? 'quickstart_read' : 'landing_engaged');
  }, Math.max(0, 10_000 - visibleMs));
}

function start() {
  if (started || readConsent() !== 'accepted') return;
  started = true;
  trackFunnel('page_view');
  if (quickstart) trackFunnel('quickstart_view');
  if (landing || quickstart) resume();
}

syncFunnelConsent();
start();
window.addEventListener('cookie-consent-change', () => {
  syncFunnelConsent();
  if (readConsent() !== 'accepted') pause();
  else { start(); if (landing || quickstart) resume(); }
});
document.addEventListener('visibilitychange', () => {
  pause();
  if (started && (landing || quickstart)) resume();
});
window.addEventListener('pagehide', pause);
window.addEventListener('pageshow', () => { if (started && (landing || quickstart)) resume(); });
document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!link || link.origin !== location.origin || !/^\/pricing\/(?:usage|builder)\/?$/.test(link.pathname)) return;
  trackFunnel('cta_click', { placement: link.dataset.acquisitionCta || (link.closest('header') ? 'navigation' : 'content') });
});
