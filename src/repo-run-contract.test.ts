import test from 'node:test';
import assert from 'node:assert/strict';
import { launchIdentity, normalizeRepo, repoRunUrl } from './repo-run-contract.ts';

test('share links preserve launch settings without a private run identity', () => {
  const url = repoRunUrl({ repo: 'https://github.com/acme/demo.git', ref: 'feature/a', size: 'small', cwd: 'apps/web',
    setupCommand: 'npm ci && echo "ready"', startCommand: 'npm run dev -- --host 0.0.0.0', port: 3000 }, 'https://mainbrella.com');
  assert.equal(url.pathname, '/run/'); assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('repo'), 'acme/demo');
  assert.equal(url.searchParams.get('ref'), 'feature/a');
  assert.equal(url.searchParams.get('setupCommand'), 'npm ci && echo "ready"');
  assert.equal(url.searchParams.get('cwd'), 'apps/web');
  assert.equal(url.searchParams.get('port'), '3000');
  assert.equal(url.searchParams.has('size'), false);
  assert.equal(normalizeRepo('  acme/demo  '), 'acme/demo');
});
test('private launch identity and uncertain request keys are distinct and validated', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(launchIdentity(`#launch=${id}`), { kind: 'launch', id });
  assert.deepEqual(launchIdentity(`#request=${id}`), { kind: 'request', id });
  for (const hash of ['', '#launch=bad', `#launch=${id}&repo=other`, '#token=secret']) assert.equal(launchIdentity(hash), null);
});
