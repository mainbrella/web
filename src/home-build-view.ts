import { buildLoginUrl, saveBuildPrompt } from './build-onboarding.ts';

const form = document.querySelector<HTMLFormElement>('#home-build-form');
const prompt = document.querySelector<HTMLInputElement>('#home-build-prompt');
const error = document.querySelector<HTMLElement>('#home-build-error');

if (form && prompt && error) {
  const input = prompt;
  const feedback = error;
  input.addEventListener('input', () => {
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    feedback.hidden = true;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) {
      input.setCustomValidity('Describe the app you want to build.');
      input.reportValidity();
      return;
    }
    try {
      const brief = crypto.randomUUID();
      saveBuildPrompt(window.sessionStorage, brief, input.value);
      window.location.assign(buildLoginUrl(brief, window.location.origin));
    } catch {
      input.setAttribute('aria-invalid', 'true');
      feedback.textContent = 'Could not save your idea. Allow browser storage, then try again.';
      feedback.hidden = false;
      input.focus();
    }
  });
}
