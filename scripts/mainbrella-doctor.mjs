#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const remedies = {
  401: 'Create or renew an API key at https://mainbrella.com/api-keys/.',
  402: 'Active paid access or a coupon trial is required. Check the dashboard.',
  403: 'Check the API origin and credential configuration.',
  429: 'Wait for the applicable quota to reset; do not retry launches.',
  503: 'Service unavailable. Retry this read-only check later.',
};

export async function runDoctor({ env = process.env, fetcher = fetch, cwd = process.cwd(),
} = {}) {
  const checks = [];
  const check = (name, ok, message) => checks.push({ name, ok, message });
  const project = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod']
    .filter(file => existsSync(resolve(cwd, file)));
  const packageManager = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json']
    .find(file => existsSync(resolve(cwd, file))) ?? null;
  check('node', Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required.');
  const key = env.MAINBRELLA_API_KEY;
  check('credential', typeof key === 'string' && /^mb_[A-Za-z0-9_-]+$/.test(key),
    'Set MAINBRELLA_API_KEY to a named mb_ API key. Its value is never printed.');
  let base;
  try {
    base = new URL(env.MAINBRELLA_API_URL || 'https://api.mainbrella.com');
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
      || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error();
    check('api_url', true, 'API URL is valid.');
  } catch { check('api_url', false, 'Use an HTTPS API origin, or HTTP localhost for local development.'); }

  if (checks.find(item => item.name === 'api_url').ok) {
    async function get(path, authenticated = true) {
      try {
        const response = await fetcher(new URL(path, base), {
          headers: authenticated ? { Authorization: `Bearer ${key}` } : {}, redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          check(path, false, `HTTP ${response.status}. ${remedies[response.status] || 'Check the documented API route and environment.'}`);
          return null;
        }
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
        return data;
      } catch {
        check(path, false, 'Could not read an API response. Check connectivity and retry this read-only check.');
        return null;
      }
    }
    const capabilities = await get('/capabilities', false);
    if (capabilities) {
      const execution = capabilities.execution;
      check('capabilities', typeof capabilities.apiVersion === 'string', 'Deployment capability contract must include an API version.');
      check('foreground', execution?.foreground === true, 'Foreground execution must be supported.');
      check('binary_files', capabilities.files?.read === true && capabilities.files?.write === true
        && capabilities.files?.binary === true, 'Binary file read/write must be supported.');
      check('managed_execution', ['background', 'streaming', 'reconnect', 'cancellation'].every(feature => execution?.[feature] === true),
        'Managed execution, streaming, reconnect and cancellation must be supported. Capabilities describe deployment support, not health or account access.');
    }
    if (!checks.find(item => item.name === 'credential').ok) {
      return { ok: false, readOnly: true, project, packageManager, checks };
    }
    const status = await get('/containers');
    if (status) {
      if (!Array.isArray(status.containers) || !Array.isArray(status.imageCatalog)
        || typeof status.active !== 'boolean' || !Number.isInteger(status.limits?.maxContainers)
        || !Number.isInteger(status.limits?.maxStartsPerMonth) || !Number.isInteger(status.usage?.starts)) {
        check('status', false, 'Unexpected status response. Check the API version.');
      } else {
        check('authentication', true, 'API key accepted.');
        check('entitlement', status.active, status.active ? 'Container access is active.' : remedies[402]);
        check('concurrency', status.containers.length < status.limits.maxContainers,
          status.containers.length < status.limits.maxContainers ? 'A container slot is available.' : 'No free slots. Reuse only an authorized container; preserve existing work.');
        check('starts', status.usage.starts < status.limits.maxStartsPerMonth,
          status.usage.starts < status.limits.maxStartsPerMonth ? 'Monthly starts are available.' : 'No monthly starts remain. Reuse authorized work or wait for the next UTC month.');
        check('catalog', status.imageCatalog.length > 0, status.imageCatalog.length ? 'Published catalog images are available.' : 'No catalog images are currently published.');
      }
    }
    const images = await get('/images');
    if (images) check('images', Array.isArray(images.images) && typeof images.buildsEnabled === 'boolean',
      typeof images.buildsEnabled === 'boolean' ? (images.buildsEnabled ? 'Custom image builds are enabled.' : 'Custom image builds are disabled; use a published catalog image.') : 'Unexpected image response.');
    const schema = await get('/openapi.json');
    if (schema) {
      check('http_execution', schema.paths?.['/containers/exec']?.post?.operationId === 'executeContainerCommand',
        schema.paths?.['/containers/exec']?.post?.operationId === 'executeContainerCommand'
          ? 'HTTP command execution is advertised.' : 'This API deployment does not advertise HTTP execution. Update the backend before verification.');
      const files = schema.paths?.['/containers/files'];
      const filesAvailable = files?.get?.operationId === 'readContainerFile' && files?.put?.operationId === 'writeContainerFile';
      check('http_files', filesAvailable, filesAvailable ? 'HTTP file read/write is advertised.'
        : 'This API deployment does not advertise HTTP files. Update the backend before verification.');
    }
  }
  return { ok: checks.every(item => item.ok), readOnly: true, project, packageManager, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) {
    console.error('Usage: node mainbrella-doctor.mjs (reads MAINBRELLA_API_KEY and optional MAINBRELLA_API_URL)');
    process.exitCode = 1;
  } else {
    const report = await runDoctor();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
}
