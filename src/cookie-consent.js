import { readConsent, saveConsent } from './cookie-preferences.js';

const dialog = document.querySelector('#cookie-consent');
let trackingLoaded = false;

function loadTracking() {
  if (trackingLoaded) return;
  trackingLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'AW-18496708678');

  const googleTag = document.createElement('script');
  googleTag.async = true;
  googleTag.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18496708678';
  document.head.append(googleTag);

  if (!window.oaiq) {
    const queue = function () { queue.q.push(arguments); };
    queue.q = [];
    window.oaiq = queue;
    const openaiPixel = document.createElement('script');
    openaiPixel.async = true;
    openaiPixel.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
    document.head.append(openaiPixel);
  }
  window.oaiq('init', { pixelId: 'QeBc7EgP6cvtRWN38MkXjE', debug: true });
}

if (dialog) {
  let returnFocus;
  function openDialog(trigger) {
    returnFocus = trigger || document.querySelector('.brand');
    document.documentElement.classList.add('cookie-consent-open');
    if (!dialog.open) dialog.showModal();
  }

  // Native modal behavior traps focus and makes the rest of the page inert.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-consent]');
    if (!button || !dialog.open) return;
    const choice = button.dataset.consent;
    if (choice !== 'accepted' && choice !== 'rejected') return;
    saveConsent(choice);
    dialog.close();
    document.documentElement.classList.remove('cookie-consent-open');
    returnFocus?.focus({ preventScroll: true });
    if (choice === 'accepted') loadTracking();
    window.dispatchEvent(new CustomEvent('cookie-consent-change', { detail: { choice } }));
  });
  document.querySelectorAll('[data-cookie-settings]').forEach((button) => {
    button.addEventListener('click', () => openDialog(button));
  });

  const savedChoice = readConsent();
  if (savedChoice === 'accepted') loadTracking();
  else if (!savedChoice) openDialog();
}
