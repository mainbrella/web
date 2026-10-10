import { normalizeRepo, validRepo } from './repo-run-contract.ts';

const form = document.querySelector<HTMLFormElement>('#try-form');
const input = document.querySelector<HTMLInputElement>('#try-repo');
const error = document.querySelector<HTMLParagraphElement>('#try-repo-error');

if (form && input && error) {
  const repoInput = input;
  const repoError = error;
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
      repoInput.setCustomValidity('Enter a public GitHub URL or owner/repository.');
      repoInput.setAttribute('aria-invalid', 'true');
      repoError.textContent = 'Enter a public GitHub URL or owner/repository.';
      repoError.hidden = false;
      repoInput.focus();
      return;
    }
    repoInput.value = repo;
  });
}
