import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFunding, repoFundingUrl } from './repo-funding.ts';

test('funding keeps repository configuration and private access through checkout', () => {
  const destination = new URL('https://mainbrella.com/run/?flow=try&private=1&prepare=1#config=9c854f89-5f3e-467c-b5f2-0bc6685ef75c');
  const url = new URL(repoFundingUrl('https://github.com/owner/repo', destination), destination.origin);
  assert.equal(url.pathname, '/pricing/usage/');
  assert.equal(url.searchParams.get('flow'), 'try');
  const funding = readRepoFunding(Object.fromEntries(url.searchParams), destination.origin)!;
  assert.equal(funding.repo, 'owner/repo');
  assert.equal(funding.returnTo, '/run/?flow=try&private=1#config=9c854f89-5f3e-467c-b5f2-0bc6685ef75c');
  assert.equal(destination.searchParams.get('prepare'), '1');
});

test('checkout return destinations must be same-origin repository pages', () => {
  for (const returnTo of ['https://evil.test/run/', '//evil.test/run/', '/\\evil.test/run/', '/pricing/', '/login/', 'javascript:alert(1)']) {
    assert.equal(readRepoFunding({ repo: 'owner/repo', returnTo }, 'https://mainbrella.com'), null);
  }
  assert.equal(readRepoFunding({ repo: 'invalid', returnTo: '/run/' }, 'https://mainbrella.com'), null);
});
