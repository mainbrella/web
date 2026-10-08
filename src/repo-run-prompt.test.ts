import test from 'node:test';
import assert from 'node:assert/strict';
import { repoSetupPrompt, validRepo } from './repo-run-prompt.ts';
import type { RepositoryLaunch } from './repo-run-contract.ts';

test('the Happier prompt delegates source inspection and requests readable YAML without a configured URL', () => {
  const settings = { repo: 'https://github.com/happier-dev/happier', size: 'small', cwd: '.', ref: 'feature/ports',
    setupCommand: 'yarn --version && yarn install --frozen-lockfile && yarn build',
    startCommand: 'HAPPIER_STACK_SERVER_PORT_BASE=3005 HAPPIER_STACK_SERVER_PORT_RANGE=1 HAPPIER_SERVER_HOST=0.0.0.0 yarn start', port: 3005 };
  const prompt = repoSetupPrompt(settings, 'https://mainbrella.com');
  assert.match(prompt, /https:\/\/github.com\/happier-dev\/happier/);
  assert.match(prompt, /source behind its startup command/);
  assert.match(prompt, /before installing/);
  assert.match(prompt, /environment variables in each command/);
  assert.match(prompt, /proxy strips cookies/);
  assert.match(prompt, /without requiring an API key/);
  assert.match(prompt, /Return only one YAML code block/);
  assert.match(prompt, /YAML literal block scalars \(\|-\) for both setupCommand and startCommand/);
  assert.match(prompt, /readable, properly indented multiline Bash scripts with real newlines/);
  assert.match(prompt, /Do not serialize shell scripts as escaped JSON strings/);
  assert.match(prompt, /startCommand: the complete server shell command/);
  assert.match(prompt, /port.*integer/);
  assert.match(prompt, /do not use null, empty commands, placeholders or abbreviated commands/);
  assert.match(prompt, /repo: happier-dev\/happier/);
  assert.match(prompt, /HAPPIER_STACK_SERVER_PORT_BASE=3005/);
  assert.equal(prompt.includes('/run/?'), false);
  assert.equal(prompt.includes('URLSearchParams'), false);
  assert.match(prompt, /Do not create a container or execute commands.*unless I explicitly ask/);
  assert.match(prompt, /Available API credentials are not permission/);
});

test('a repair prompt identifies the exact existing container and includes execution IDs, never a preview token', () => {
  const launch: RepositoryLaunch = { id: 'private-launch', phase: 'failed', options: { repo: 'happier-dev/happier', size: 'small', cwd: '.' },
    repository: { repo: 'happier-dev/happier', ref: 'main', commit: 'a'.repeat(40), suggestedCatalogId: 'node', manifests: ['package.json'] },
    container: { id: 'small', createdAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-10-08T13:00:00.000Z' },
    executions: { setup: 'setup-execution' }, shellReadyAt: 1, previewReadyAt: null, createdAt: 1, error: 'setup_failed' };
  const prompt = repoSetupPrompt(launch.options, 'https://mainbrella.com', launch);
  assert.match(prompt, /do not allocate another/);
  assert.match(prompt, /"createdAt": "2026-10-08T12:00:00.000Z"/);
  assert.match(prompt, /setup-execution/);
  assert.match(prompt, /does not automatically resume/);
  assert.match(prompt, /preserving completed work/);
  assert.equal(prompt.includes(launch.container!.expiresAt), false);
  assert.match(prompt, /corrected reusable YAML configuration/);
  assert.equal(prompt.includes('/run/?'), false);
});

test('only repository roots accepted by the launch API can generate prompts', () => {
  for (const repo of ['happier-dev/happier', 'https://github.com/happier-dev/happier.git/', ' user/repo ']) assert.equal(validRepo(repo), true);
  for (const repo of ['', 'https://example.com/user/repo', 'https://github.com/user/repo/tree/main', 'user/repo?token=secret', 'user/..', '/user/repo']) assert.equal(validRepo(repo), false);
});
