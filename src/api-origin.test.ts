import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiOrigin } from './api-origin.ts';

test('API origin selects staging, localhost, and production defaults by hostname', () => {
  assert.equal(resolveApiOrigin('stg.mainbrella.com'), 'https://api-stg.mainbrella.com');
  assert.equal(resolveApiOrigin('localhost'), 'http://localhost:8787');
  assert.equal(resolveApiOrigin('127.0.0.1'), 'http://localhost:8787');
  assert.equal(resolveApiOrigin('mainbrella.com'), 'https://api.mainbrella.com');
});

test('explicit API origin is honored except when staging points at production', () => {
  assert.equal(resolveApiOrigin('stg.mainbrella.com', 'https://api-stg.mainbrella.com'), 'https://api-stg.mainbrella.com');
  assert.equal(resolveApiOrigin('mainbrella.com', 'https://custom-api.example'), 'https://custom-api.example');
  for (const productionOrigin of [
    'https://api.mainbrella.com',
    'http://api.mainbrella.com',
    'https://API.MAINBRELLA.COM',
    'https://api.mainbrella.com/',
    'https://api.mainbrella.com:8443/v1',
  ]) {
    assert.throws(() => resolveApiOrigin('stg.mainbrella.com', productionOrigin), /Staging is configured with the production API/);
  }
});
