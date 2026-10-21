// Remove records left by the retired consent dialog and browser analytics.
// Preserve authentication, payment retries, drafts, and other application state.
const legacyKeys = new Set([
  'mainbrella-cookie-consent',
  'mainbrella-acquisition',
  'mainbrella:acquisition-pending',
  'mainbrella:acquisition-account',
  'mainbrella-confirmed-checkouts',
]);

for (const storageName of ['localStorage', 'sessionStorage'] as const) {
  try {
    const storage = window[storageName];
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key && (legacyKeys.has(key) || key.startsWith('mainbrella-machine-days:'))) storage.removeItem(key);
    }
  } catch { /* Blocked storage must not prevent browsing or signing in. */ }
}

// Expire accessible first-party Google and Clarity cookies from older visits.
// Third-party cookies belong to their providers and cannot be cleared here.
try {
  const domains = new Set(['', window.location.hostname]);
  const labels = window.location.hostname.split('.');
  for (let index = 0; index < labels.length - 1; index++) domains.add(`.${labels.slice(index).join('.')}`);
  const paths = new Set(['/']);
  const segments = window.location.pathname.split('/');
  for (let index = 1; index < segments.length; index++) {
    const path = segments.slice(0, index + 1).join('/');
    paths.add(path);
    paths.add(path.replace(/\/$/, '') + '/');
  }
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (!/^(?:_ga(?:_|$)|_gid$|_gat(?:_|$)|_gcl_|_clck$|_clsk$)/.test(name)) continue;
    for (const domain of domains) {
      for (const path of paths) {
        document.cookie = `${name}=; Max-Age=0; Path=${path}${domain ? `; Domain=${domain}` : ''}`;
      }
    }
  }
} catch { /* Cookie access can be blocked independently of browser storage. */ }

export {};
