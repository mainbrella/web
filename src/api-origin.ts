const STAGING_API_ORIGIN = 'https://api-stg.mainbrella.com';
const PRODUCTION_API_HOST = 'api.mainbrella.com';

export function resolveApiOrigin(hostname: string, configured?: string): string {
  if (configured) {
    if (hostname === 'stg.mainbrella.com') {
      let configuredHost = '';
      try {
        configuredHost = new URL(configured, 'https://invalid.local').hostname.toLowerCase();
      } catch { /* Preserve the explicit value; fetch will report an invalid URL. */ }
      if (configuredHost === PRODUCTION_API_HOST) {
        throw new Error('Staging is configured with the production API. Set VITE_API_URL=https://api-stg.mainbrella.com before building.');
      }
    }
    return configured;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8787';
  if (hostname === 'stg.mainbrella.com') return STAGING_API_ORIGIN;
  return 'https://api.mainbrella.com';
}

export const API_ORIGIN = resolveApiOrigin(typeof location === 'undefined' ? '' : location.hostname, import.meta.env?.VITE_API_URL);
