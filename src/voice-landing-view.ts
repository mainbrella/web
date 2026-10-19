// Use the unrounded three-minute example shown on the page.
const volume = document.querySelector<HTMLInputElement>('#voice-call-volume');
const volumeError = document.querySelector<HTMLElement>('#voice-volume-error');
const mainbrellaEstimate = document.querySelector<HTMLElement>('#voice-mainbrella-estimate');
const blandEstimate = document.querySelector<HTMLElement>('#voice-bland-estimate');
const volumeLabel = document.querySelector<HTMLElement>('#voice-estimate-volume');

if (volume && volumeError && mainbrellaEstimate && blandEstimate && volumeLabel) {
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const count = new Intl.NumberFormat('en-US');
  document.querySelector<HTMLElement>('#voice-volume-control')!.hidden = false;
  volume.addEventListener('input', () => {
    const calls = volume.valueAsNumber;
    const valid = volume.validity.valid && Number.isInteger(calls);
    volume.setAttribute('aria-invalid', String(!valid));
    volumeError.hidden = valid;
    if (!valid) return;
    mainbrellaEstimate.textContent = currency.format(calls * 0.0853);
    blandEstimate.textContent = currency.format(calls * 3 * 0.14);
    volumeLabel.textContent = count.format(calls);
  });
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove('voice-reveal-pending');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08 });
  for (const section of document.querySelectorAll<HTMLElement>('[data-voice-reveal]')) {
    section.classList.add('voice-reveal-pending');
    observer.observe(section);
  }
}
