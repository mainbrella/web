import './landing.css';

const tabList = document.querySelector<HTMLElement>('[data-bff-tabs]');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bff-example]'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-bff-panel]'));
const copyButton = document.querySelector<HTMLButtonElement>('[data-bff-copy]');
const copyStatus = document.querySelector<HTMLElement>('[data-bff-copy-status]');
let copyVersion = 0;

function activateTab(tab: HTMLButtonElement, focus = false) {
  const selected = tab.dataset.bffExample;
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.dataset.bffPanel !== selected;
  copyVersion++;
  if (copyButton) { copyButton.textContent = 'Copy example'; copyButton.disabled = false; }
  if (copyStatus) copyStatus.textContent = '';
  if (focus) tab.focus();
}

if (tabList && tabs.length && panels.length) {
  tabList.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let next: number;
      switch (event.key) {
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      activateTab(tabs[next], true);
    });
  }
  for (const panel of panels) {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `bff-tab-${panel.dataset.bffPanel}`);
    panel.tabIndex = 0;
  }
  activateTab(tabs[0]);
  tabList.hidden = false;
}

if (copyButton && navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    const code = panels.find(panel => !panel.hidden)?.querySelector('code')?.textContent;
    if (!code) return;
    const version = ++copyVersion;
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(code);
      if (version !== copyVersion) return;
      copyButton.textContent = 'Copied!';
      if (copyStatus) copyStatus.textContent = 'Example copied to clipboard.';
    } catch {
      if (version !== copyVersion) return;
      copyButton.textContent = 'Try copying again';
      if (copyStatus) copyStatus.textContent = 'Could not copy. Select the code to copy it manually.';
    } finally {
      if (version === copyVersion) copyButton.disabled = false;
    }
  });
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('bff-reveal-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08 });
  for (const element of document.querySelectorAll<HTMLElement>('[data-bff-reveal]')) {
    element.classList.add('bff-reveal-ready');
    observer.observe(element);
  }
}
