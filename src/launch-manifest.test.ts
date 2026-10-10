import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepoRunConfig } from './repo-run-config.ts';

const html = readFileSync(new URL('../yaml/index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../public/schemas/launch-manifest-0.1.json', import.meta.url), 'utf8'));
const examples = [...html.matchAll(/<code\b([^>]*)\bdata-launch-example\b[^>]*>([\s\S]*?)<\/code>/g)]
  .map(([, attributes, yaml]) => ({ attributes, yaml }));

test('documented launch examples parse and describe pinned runnable repositories', () => {
  assert.equal(examples.length, 3, 'keep every documented launch example covered');
  const configs = examples.map(({ yaml }) => parseRepoRunConfig(yaml));

  for (const config of configs) assert.match(config.ref ?? '', /^[a-f0-9]{40}$/);

  const previews = configs.filter(config => config.startCommand !== undefined);
  assert.equal(previews.length, 2);
  for (const config of previews) {
    assert.equal(typeof config.port, 'number');
    assert.match(config.startCommand ?? '', /(?:--bind|--host) 0\.0\.0\.0/);
  }

  const terminal = configs.find(config => config.repo === 'cli/cli');
  assert.ok(terminal);
  assert.equal(terminal.cwd, '.');
  assert.equal(terminal.startCommand, undefined);
  assert.equal(terminal.port, undefined);
});

test('draft 0.1 schema matches the parser fields and supported choices', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'https://mainbrella.com/schemas/launch-manifest-0.1.json');
  assert.deepEqual(Object.keys(schema.properties).sort(),
    ['repo', 'ref', 'catalogId', 'size', 'cwd', 'setupCommand', 'startCommand', 'port'].sort());
  assert.deepEqual(schema.required, ['repo']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.catalogId.enum, ['node', 'python', 'rust', 'go', 'devops']);
  assert.deepEqual(schema.properties.size.enum, ['lite', 'small', 'medium', 'large', 'xl']);
  assert.deepEqual(schema.dependentRequired, { startCommand: ['port'], port: ['startCommand'] });
});
