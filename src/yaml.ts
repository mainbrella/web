const copyButtons = document.querySelectorAll<HTMLButtonElement>('[data-copy-example]');

if (navigator.clipboard?.writeText) {
  for (const button of copyButtons) {
    const code = document.getElementById(button.dataset.copyExample ?? '');
    const status = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    if (!code || !status) continue;
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        status.textContent = 'YAML copied.';
      } catch {
        status.textContent = 'Could not copy. Select the YAML above and copy it manually.';
      } finally {
        button.disabled = false;
      }
    });
  }
}
