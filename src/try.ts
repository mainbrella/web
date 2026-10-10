import { normalizeRepo, validRepo } from './repo-run-contract.ts';
import { readConsent } from './cookie-preferences.ts';
import { captureRepository } from './acquisition-spine.ts';
import { firstTouchAttribution } from './acquisition-analytics.ts';

const form = document.querySelector<HTMLFormElement>('#try-form');
const input = document.querySelector<HTMLInputElement>('#try-repo');
const error = document.querySelector<HTMLParagraphElement>('#try-repo-error');

if (form && input && error) {
  const repoInput = input;
  const repoError = error;
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const continueLabel = submitButton?.textContent || 'Continue';
  function restoreContinue() {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = continueLabel; }
  }
  if (readConsent() === 'accepted') firstTouchAttribution();
  window.addEventListener('pageshow', restoreContinue);
  window.addEventListener('cookie-consent-change', event => {
    if ((event as CustomEvent).detail?.choice === 'accepted') firstTouchAttribution();
  });
  form.noValidate = true;
  function clearError() {
    repoInput.setCustomValidity('');
    repoInput.removeAttribute('aria-invalid');
    repoError.hidden = true;
    repoError.textContent = '';
  }

  repoInput.addEventListener('input', clearError);
  form.addEventListener('submit', event => {
    const repo = normalizeRepo(repoInput.value);
    if (!validRepo(repo)) {
      event.preventDefault();
      repoInput.setCustomValidity('Enter a GitHub URL or owner/repository.');
      repoInput.setAttribute('aria-invalid', 'true');
      repoError.textContent = 'Enter a GitHub URL or owner/repository.';
      repoError.hidden = false;
      repoInput.focus();
      return;
    }
    repoInput.value = repo;
    if (form.querySelector<HTMLInputElement>('input[name="private"]')?.checked || readConsent() !== 'accepted') return;
    event.preventDefault();
    if (submitButton) submitButton.disabled = true;
    if (submitButton) submitButton.textContent = 'Continuing…';
    void captureRepository(repo, 'try_v1').finally(() => form.submit());
  });
}
