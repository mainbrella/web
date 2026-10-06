const consentKey = 'mainbrella-cookie-consent';
const dialog = document.querySelector('#cookie-consent');

function readConsent() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const choice = window[storageName].getItem(consentKey);
      if (choice === 'accepted' || choice === 'rejected') return choice;
    } catch {
      // Some browsers block storage; a visitor can still make a choice.
    }
  }
  return null;
}

function saveConsent(choice) {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      window[storageName].setItem(consentKey, choice);
      return;
    } catch {
      // Fall back to remembering the choice for this tab when possible.
    }
  }
}

function loadTracking() {
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
  const savedChoice = readConsent();

  if (savedChoice === 'accepted') {
    loadTracking();
  } else if (!savedChoice) {
    // Native modal behavior traps focus and makes the rest of the page inert.
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-consent]');
      if (!button) return;

      const choice = button.dataset.consent;
      saveConsent(choice);
      dialog.close();
      document.documentElement.classList.remove('cookie-consent-open');
      document.querySelector('.brand')?.focus({ preventScroll: true });
      if (choice === 'accepted') loadTracking();
    });

    document.documentElement.classList.add('cookie-consent-open');
    dialog.showModal();
  }
}
