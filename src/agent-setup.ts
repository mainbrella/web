const buttons = document.querySelectorAll<HTMLButtonElement>('[data-copy-agent-setup]');
const instructions = document.querySelector<HTMLElement>('#agent-instructions')!;

if (instructions) {
  // Read the source text even while the setup details are collapsed.
  const text = [...instructions.querySelectorAll<HTMLElement>('h3, p')]
    .map(element => (element.textContent ?? "").trim()).join('\n\n');

  buttons.forEach(button => {
    const status = document.getElementById(button.getAttribute('aria-describedby')!)!;
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Instructions copied. Paste them into your agent.';
      } catch {
        instructions.closest<HTMLDetailsElement>('details')!.open = true;
        instructions.scrollIntoView({ block: 'center', behavior: 'instant' });
        status.textContent = 'Could not copy. Select and copy the setup instructions.';
        document.querySelector<HTMLElement>('#agent-copy-status')!.textContent = status.textContent;
      } finally {
        button.disabled = false;
      }
    });
  });
}
