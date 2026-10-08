import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoRunConfig, stringifyRepoRunConfig, validateRepoRunConfig } from './repo-run-config.ts';

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

test('raw and fenced YAML preserve multiline shell commands, quotes and environment variables', () => {
  const value = { ...config, setupCommand: 'set -euo pipefail\n\nexport NODE_OPTIONS="--max-old-space-size=8192"\nprintf \'%s\\n\' "${NODE_OPTIONS}"\nyarn install --frozen-lockfile\nyarn build',
    startCommand: 'set -euo pipefail\nexport NODE_ENV=production\nexec yarn start' };
  const yaml = stringifyRepoRunConfig(value);
  assert.match(yaml, /setupCommand: \|-\n/);
  assert.match(yaml, /startCommand: \|-\n/);
  assert.deepEqual(parseRepoRunConfig(yaml), value);
  assert.deepEqual(parseRepoRunConfig(`Here is the config:\n\n\`\`\`yaml\n${yaml}\n\`\`\`\nSource-only checks.`), value);
  assert.deepEqual(parseRepoRunConfig(`\`\`\`\n${yaml}\n\`\`\``), value);
});

test('YAML parsing rejects duplicate keys, tags, aliases and multiple documents or configs', () => {
  for (const text of [
    'repo: acme/demo\nrepo: other/demo',
    'repo: !custom acme/demo',
    'repo: &name acme/demo\nref: *name',
    'repo: acme/demo\nsetupCommand: |\n  npm install\n invalid-indent',
    'repo: acme/demo\n---\nrepo: other/demo',
    `\`\`\`yaml\n${stringifyRepoRunConfig(config)}\n\`\`\`\n\`\`\`yml\n${stringifyRepoRunConfig({ ...config, repo: 'other/demo' })}\n\`\`\``,
    `\`\`\`yaml\n${stringifyRepoRunConfig(config)}\n\`\`\`\n\`\`\`json\n${JSON.stringify({ ...config, repo: 'other/demo' })}\n\`\`\``,
  ]) assert.throws(() => parseRepoRunConfig(text));
});

test('stringifying a config uses YAML literal blocks even for one-line commands', () => {
  const text = stringifyRepoRunConfig({ repo: 'acme/demo', size: 'small', cwd: '.', startCommand: 'npm start', port: 3000 });
  assert.match(text, /startCommand: \|-\n  npm start/);
  assert.deepEqual(parseRepoRunConfig(text), { repo: 'acme/demo', size: 'small', cwd: '.', startCommand: 'npm start', port: 3000 });
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
