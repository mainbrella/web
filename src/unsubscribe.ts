import { API_ORIGIN } from './api-origin.ts';

const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#unsubscribe-status')!;
const retry = document.querySelector<HTMLButtonElement>('#unsubscribe-retry')!;
const email = new URLSearchParams(location.search).get('email')?.trim();

async function unsubscribe() {
  retry.hidden = true;
  main.setAttribute('aria-busy', 'true');
  status.textContent = 'Unsubscribing you from marketing emails…';
  try {
    if (!email) {
      status.textContent = 'This unsubscribe link is missing an email address. Use the link at the bottom of your marketing email.';
      return;
    }
    const response = await fetch(`${API_ORIGIN}/api/unsubscribe`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (response.status === 400) {
      status.textContent = 'This unsubscribe link is invalid. Use the link at the bottom of your marketing email.';
      return;
    }
    const result = await response.json();
    if (!response.ok || result?.ok !== true) throw new Error('unsubscribe_failed');
    status.textContent = 'You have been unsubscribed. You won’t receive any more marketing emails from Mainbrella.';
  } catch {
    status.textContent = 'We couldn’t unsubscribe you. Check your connection and try again.';
    retry.hidden = false;
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

retry.addEventListener('click', unsubscribe);
void unsubscribe();
