import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoRunConfig, validateRepoRunConfig } from './repo-run-config.ts';

const config = { repo: 'happier-dev/happier', ref: 'a'.repeat(40), catalogId: 'node', size: 'large', cwd: 'apps/web',
  setupCommand: 'yarn install --frozen-lockfile && yarn build',
  startCommand: 'HOST=0.0.0.0 PORT=53005 yarn start', port: 53005 };

test('raw JSON and complete AI responses preserve every setting and shell characters', () => {
  const value = { ...config, setupCommand: 'printf \'{"nested":{"quote":"\\\\"}}}\'\nFOO="a & b # +" yarn build',
    startCommand: 'echo "${PORT}"; HOST=0.0.0.0 yarn start' };
  const json = JSON.stringify(value, null, 2);
  for (const text of [json, `Here is the configuration:\n\n\`\`\`json\n${json}\n\`\`\`\nSource-only checks; no container created.`,
    `A manifest example: {"name":"demo","scripts":{"start":"yarn start"}}\nConfiguration: ${json}\nReady to review.`]) {
    assert.deepEqual(parseRepoRunConfig(text), value);
  }
});

test('normalizes repository URLs and uses backend defaults for terminal-only recipes', () => {
  assert.deepEqual(parseRepoRunConfig('{"repo":"https://github.com/acme/demo.git/"}'), { repo: 'acme/demo', size: 'small', cwd: '.' });
  for (const size of ['lite', 'small', 'medium', 'large', 'xl']) assert.equal(validateRepoRunConfig({ repo: 'acme/demo', size }).size, size);
});

test('rejects malformed, missing and ambiguous configurations', () => {
  for (const text of ['', 'No configuration available.', '{"repo":"acme/demo",}', 'null', '[]', '[{"repo":"acme/demo"}]',
    '{"options":{"repo":"acme/demo"}}', JSON.stringify({ setupCommand: 'npm ci' })]) assert.throws(() => parseRepoRunConfig(text));
  assert.throws(() => parseRepoRunConfig(`Choose one:\n${JSON.stringify(config)}\n${JSON.stringify({ ...config, port: 3000 })}`), /multiple repository configurations/);
  assert.throws(() => parseRepoRunConfig('x'.repeat(100001)), /too long/);
});

test('rejects fields and types that the launch API cannot accept', () => {
  const invalid = [
    { repo: 'acme/..' }, { repo: 'https://example.com/acme/demo' }, { repo: 'acme/demo?token=secret' }, { repo: null },
    { catalogId: 'ruby' }, { catalogId: null }, { size: 'huge' }, { size: 1 }, { cwd: '../web' }, { cwd: '/web' },
    { cwd: 'apps/./web' }, { cwd: 'apps/../web' }, { cwd: '' }, { cwd: null }, { cwd: 'x'.repeat(201) },
    { ref: '' }, { ref: null }, { ref: 'main\n' }, { ref: 'a'.repeat(201) },
    { setupCommand: '' }, { setupCommand: '  ' }, { setupCommand: 1 }, { setupCommand: 'echo\0' }, { setupCommand: 'x'.repeat(4097) },
    { startCommand: null }, { port: '3000' }, { port: null }, { port: 1023 }, { port: 65536 }, { port: 3000.5 },
    { apiKey: 'secret' }, { imageId: 'custom' },
  ];
  for (const fields of invalid) assert.throws(() => validateRepoRunConfig({ ...config, ...fields }), JSON.stringify(fields));
  assert.equal(validateRepoRunConfig({ ...config, setupCommand: 'x'.repeat(4096) }).setupCommand?.length, 4096);
});

test('requires a start command and integer port together', () => {
  assert.throws(() => validateRepoRunConfig({ repo: config.repo, startCommand: 'npm start' }), /together/);
  assert.throws(() => validateRepoRunConfig({ repo: config.repo, port: 3000 }), /together/);
  for (const port of [1024, 65535]) assert.equal(validateRepoRunConfig({ ...config, port }).port, port);
});
