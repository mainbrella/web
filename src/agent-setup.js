const button = document.querySelector('#copy-agent-setup');
const instructions = document.querySelector('#agent-instructions');
const status = document.querySelector('#agent-copy-status');

if (button && instructions && status && navigator.clipboard?.writeText) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(instructions.innerText.trim());
      status.textContent = 'Instructions copied.';
    } catch {
      status.textContent = 'Could not copy. Select and copy the instructions above.';
    } finally { button.disabled = false; }
  });
}
