import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { artifactHash, dispatchRelease, parseArguments, release, validateConfiguration } from './release.mjs';
import { targetFor, targets } from './deploy-targets.mjs';

const sourceSha = 'a'.repeat(40);
const deploymentVersion = '12345678-1234-1234-1234-123456789abc';
const productionEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'mainbrella/web',
  GITHUB_WORKFLOW_REF: 'mainbrella/web/.github/workflows/deploy.yml@refs/heads/main',
  RELEASE_SHA: sourceSha,
};

function withoutConsoleOutput(callback) {
  const log = console.log;
  console.log = () => {};
  try { return callback(); } finally { console.log = log; }
}

function fixture(t, name, directory = mkdtempSync(join(tmpdir(), 'canopy-deploy-'))) {
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = targetFor(name);
  const app = join(directory, target.directory);
  mkdirSync(app, { recursive: true });
  const wranglerPackage = join(app, 'node_modules/wrangler');
  mkdirSync(join(wranglerPackage, 'bin'), { recursive: true });
  writeFileSync(join(wranglerPackage, 'package.json'), JSON.stringify({ name: 'wrangler', version: '0.0.0' }));
  writeFileSync(join(wranglerPackage, 'bin/wrangler.js'), '');
  if (target.assets) {
    const assetDirectory = join(app, target.assets);
    mkdirSync(assetDirectory, { recursive: true });
    writeFileSync(join(assetDirectory, 'index.html'), '<main>built</main>');
  }
  writeFileSync(join(app, target.config), JSON.stringify(mockConfig(target), null, 2) + '\n');
  return { directory, app, target };
}

function stubRun(log, { failOn = null, status = '', sha = sourceSha, credential = { type: 'oauth', token: 'private-local-test-token' }, onCall = () => {},
  publicationContent, deploymentRows, onPublish = () => {} } = {}) {
  return (command, args, options = {}) => {
    const call = { command, args, cwd: options.cwd, env: options.env };
    log.push(call);
    onCall(call);
    if (failOn === `${command} ${args.join(' ')}`) throw new Error(`stub failed: ${failOn}`);
    if (command === 'git' && args[0] === 'status') return status;
    if (command === 'git' && args[0] === 'rev-parse') return sha;
    if (command === 'git' && args[0] === 'remote') return 'git@github.com:mainbrella/web.git';
    if (command === process.execPath && args.includes('auth') && args.includes('token')) return JSON.stringify(credential);
    if (command === 'npm' && args[0] === 'run') {
      const targetName = Object.keys(targets).find(name => targets[name].publish === args[1]);
      if (targetName) {
        const receiptPath = options.env?.WRANGLER_OUTPUT_FILE_PATH;
        assert.ok(receiptPath, 'only the scoped publisher receives the Wrangler output path');
        mkdirSync(dirname(receiptPath), { recursive: true });
        const content = typeof publicationContent === 'function'
          ? publicationContent(targets[targetName])
          : publicationContent ?? [
            { type: 'build', worker_name: targets[targetName].worker, version_id: deploymentVersion },
            { type: 'deploy', worker_name: targets[targetName].worker, version_id: null },
            { type: 'deploy', worker_name: targets[targetName].worker, version_id: deploymentVersion },
          ].map(JSON.stringify).join('\n') + '\n';
        writeFileSync(receiptPath, content);
        const output = args.find(arg => arg.startsWith('--outdir='))?.slice('--outdir='.length);
        assert.ok(output, 'publisher saves its actual bundle for release evidence');
        mkdirSync(join(options.cwd, output), { recursive: true });
        writeFileSync(join(options.cwd, output, 'worker.js'), 'published bundle');
        onPublish({ target: targets[targetName], options, receiptPath });
        if (options.env.CANOPY_SITE_ASSET_SNAPSHOT) cpSync(join(options.cwd, 'dist'), options.env.CANOPY_SITE_ASSET_SNAPSHOT, { recursive: true });
      }
    }
    if (command === process.execPath && args.includes('--dry-run')) {
      const output = args[args.indexOf('--outdir') + 1];
      mkdirSync(join(options.cwd, output), { recursive: true });
      writeFileSync(join(options.cwd, output, 'worker.js'), 'bundle');
    }
    if (command === process.execPath && args.includes('list') && args.includes('--json')) {
      return JSON.stringify(deploymentRows ?? [
        { id: 'intended-deployment', created_on: '2026-01-01T00:00:00Z',
          versions: [{ version_id: deploymentVersion }] },
        { id: 'unrelated-newer-deployment', created_on: '2026-12-31T00:00:00Z',
          versions: [{ version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] },
      ]);
    }
    return '';
  };
}

function mockConfig(target) {
  return {
    $schema: 'https://example.invalid/config-schema.json',
    name: target.worker,
    assets: target.assets ? { directory: target.assets } : undefined,
    containers: target.worker === 'mainbrella-containers'
      ? [{ class_name: 'UserContainer', images: { terminal: { dockerfile: './containers/Dockerfile' } } }]
      : undefined,
    preserved_setting: 'fixture-value',
    workers_dev: target.worker === 'mainbrella-admin' || target.worker === 'mainbrella-marketing'
      || target.worker === 'mainbrella-containers' ? false : undefined,
    preview_urls: target.worker === 'mainbrella-admin' || target.worker === 'mainbrella-marketing'
      || target.worker === 'mainbrella-containers' ? false : undefined,
  };
}

import { deployWeb, parseArguments as parseWebArguments } from './deploy.mjs';

test('each registry target publishes once without tests or dry runs', t => {
  for (const name of Object.keys(targets)) {
    const { directory, app, target } = fixture(t, name);
    const log = [];
    const originalConfigPath = join(app, target.config);
    const originalConfig = readFileSync(originalConfigPath, 'utf8');
    const receiptPath = join(directory, 'artifacts/releases', `${name}.wrangler.jsonl`);
    const evidence = withoutConsoleOutput(() => release(name, {
      publish: true,
      directory,
      env: productionEnv,
      run: stubRun(log),
      readConfig: path => {
        assert.equal(path, join(app, target.config));
        return mockConfig(target);
      },
      record: () => {},
    }));

    const npmCalls = log.filter(call => call.command === 'npm');
    assert.deepEqual(npmCalls.map(call => call.args), [
      ...target.preflight.map(script => ['run', script]),
      ['run', target.publish, '--', `--outdir=.wrangler/release-${name}`],
    ], `${name}: preflight and single publish sequence`);
    assert.ok(npmCalls.every(call => call.cwd === app), `${name}: npm runs from its app directory`);
    for (const call of npmCalls) {
      assert.equal(call.env?.WRANGLER_OUTPUT_FILE_PATH,
        call.args[1] === target.publish ? receiptPath : undefined,
        `${name}: receipt output is scoped to its publisher`);
    }
    const publishCalls = npmCalls.filter(call => call.args[1] === target.publish);
    assert.equal(publishCalls.length, 1, `${name}: one scoped publish`);

    assert.equal(log.some(call => call.args.includes('--dry-run')), false, `${name}: skips dry runs`);
    assert.equal(readFileSync(originalConfigPath, 'utf8'), originalConfig, `${name}: source config stays untouched`);
    assert.equal(evidence.target, name);
    assert.equal(evidence.worker, target.worker);
    assert.equal(evidence.sourceSha, sourceSha);
    assert.match(evidence.artifactSha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.workerVersion, deploymentVersion);
    assert.equal(evidence.deploymentId, 'intended-deployment');
  }
});

test('local releases publish the checkout directly using Wrangler login and retain release evidence', t => {
  for (const name of Object.keys(targets)) {
    const { directory, app, target } = fixture(t, name);
    const calls = [], env = { SAFE: 'yes' }, recorded = [];
    const evidence = withoutConsoleOutput(() => release(name, { publish: true, local: true,
      directory, env, run: stubRun(calls, { status: ' M scripts/deploy.mjs' }),
      readConfig: () => ({ ...mockConfig(target), account_id: 'a'.repeat(32) }),
      record: (path, content) => recorded.push({ path, content }),
    }));
    assert.equal(calls.some(call => call.command === 'gh' || call.command === 'git' && ['fetch', 'merge-base', 'remote'].includes(call.args[0])), false);
    const auth = calls.filter(call => call.args.includes('auth'));
    assert.equal(auth.length, 1);
    assert.equal(auth[0].cwd, app);
    assert.deepEqual(auth[0].args.slice(1), ['auth', 'token', '--json']);
    assert.deepEqual(auth[0].env, { SAFE: 'yes', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), WRANGLER_WRITE_LOGS: 'false' });
    assert.deepEqual(env, { SAFE: 'yes' });
    const npmCalls = calls.filter(call => call.command === 'npm');
    assert.deepEqual(npmCalls.map(call => call.args[1]), [...target.preflight, target.publish]);
    assert.ok(npmCalls.every(call => call.env.CLOUDFLARE_API_TOKEN === 'private-local-test-token'));
    assert.equal(evidence.local, true);
    assert.equal(evidence.sourceDirty, true);
    assert.equal(evidence.sourceSha, sourceSha);
    assert.equal(evidence.workerVersion, deploymentVersion);
    assert.match(evidence.artifactSha256, /^[a-f0-9]{64}$/);
    assert.ok(recorded.every(item => !item.content.includes('private-local-test-token')));
  }
});

test('web npm deploy accepts local publication, check, and help modes', () => {
  assert.deepEqual(parseWebArguments([]), { mode: 'publish' });
  assert.deepEqual(parseWebArguments(['--check']), { mode: 'check' });
  assert.deepEqual(parseWebArguments(['--help']), { mode: 'help' });
  assert.deepEqual(parseWebArguments(['-h']), { mode: 'help' });
  for (const args of [['builder'], ['--force'], ['--check', '--local']]) assert.throws(() => parseWebArguments(args), /Usage:/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts.deploy, 'node scripts/deploy.mjs');
});

test('web npm deploy publishes builder before site and records each local release', t => {
  const { directory, app } = fixture(t, 'builder');
  fixture(t, 'site', directory);
  const calls = [], env = { SAFE: 'yes' };
  const result = withoutConsoleOutput(() => deployWeb({ directory, env, run: stubRun(calls) }));
  const npmCalls = calls.filter(call => call.command === 'npm');
  assert.deepEqual(npmCalls.map(call => [call.args[1], call.cwd]), [
    ['deploy:builder', app], ['deploy:site', app],
  ]);
  assert.ok(npmCalls.every(call => call.env.CLOUDFLARE_API_TOKEN === 'private-local-test-token'));
  assert.equal(calls.filter(call => call.args.includes('auth')).length, 2);
  assert.equal(result.builder.target, 'builder');
  assert.equal(result.site.target, 'site');
  assert.equal(result.builder.local, true);
  assert.equal(result.site.local, true);
  assert.ok(existsSync(join(directory, 'artifacts/releases/builder.json')));
  assert.ok(existsSync(join(directory, 'artifacts/releases/site.json')));
  assert.equal(calls.some(call => call.command === 'gh' || call.command === 'git' && ['fetch', 'merge-base', 'remote'].includes(call.args[0])), false);
  assert.deepEqual(env, { SAFE: 'yes' });
});

test('web deploy stops before site publication when the builder fails', t => {
  const { directory } = fixture(t, 'builder');
  fixture(t, 'site', directory);
  const calls = [];
  assert.throws(() => deployWeb({ directory, env: {}, run: stubRun(calls, {
    failOn: 'npm run deploy:builder -- --outdir=.wrangler/release-builder',
  }) }), /stub failed/);
  assert.equal(calls.some(call => call.command === 'npm' && call.args[1] === 'deploy:site'), false);
});

test('failed web site publication preserves the builder release record', t => {
  const { directory } = fixture(t, 'builder');
  fixture(t, 'site', directory);
  const calls = [];
  assert.throws(() => withoutConsoleOutput(() => deployWeb({ directory, env: {}, run: stubRun(calls, {
    failOn: 'npm run deploy:site -- --outdir=.wrangler/release-site',
  }) })), /stub failed/);
  assert.ok(existsSync(join(directory, 'artifacts/releases/builder.json')));
  assert.equal(existsSync(join(directory, 'artifacts/releases/site.json')), false);
});

test('web deploy --check validates and bundles both hosts without credentials or publication', t => {
  const { directory } = fixture(t, 'builder');
  fixture(t, 'site', directory);
  const calls = [];
  deployWeb({ publish: false, directory, env: {}, run: stubRun(calls) });
  assert.deepEqual(calls.filter(call => call.command === 'npm').map(call => call.args[1]), [...targets.builder.checks, ...targets.site.checks]);
  assert.equal(calls.filter(call => call.args.includes('--dry-run')).length, 2);
  assert.equal(calls.some(call => call.args.includes('auth') || ['deploy:builder', 'deploy:site', 'db:migrate:remote'].includes(call.args[1])), false);
  assert.equal(calls.some(call => call.command === 'gh'), false);
});

test('local execute is rejected before checks or publishing', t => {
  const { directory, target } = fixture(t, 'site');
  const log = [];
  assert.throws(() => release('site', { publish: true, run: stubRun(log), directory,
    env: {}, readConfig: () => mockConfig(target), record: () => {} }), /production workflow/);
  assert.deepEqual(log, []);
});

test('release hash includes static assets rebuilt by the publisher', t => {
  const { directory, app, target } = fixture(t, 'site');
  const log = [];
  const evidence = withoutConsoleOutput(() => release('site', { publish: true,
    run: stubRun(log, { onPublish: ({ options }) => {
      assert.equal(options.env.WRANGLER_OUTPUT_FILE_PATH, join(directory, 'artifacts/releases/site.wrangler.jsonl'));
      writeFileSync(join(app, 'dist/index.html'), '<main>rebuilt by publisher</main>');
    } }), directory, env: productionEnv,
    readConfig: () => mockConfig(target), record: () => {} }));
  const expected = artifactHash([join(app, '.wrangler/release-site'), join(app, 'dist')]);
  assert.equal(evidence.artifactSha256, expected);
  assert.equal(readFileSync(join(app, 'dist/index.html'), 'utf8'), '<main>rebuilt by publisher</main>');
});

test('site release hashes the uploaded snapshot even if another build clears dist during upload', t => {
  const { directory, app, target } = fixture(t, 'site');
  let expected, snapshot;
  const evidence = withoutConsoleOutput(() => release('site', { publish: true,
    run: stubRun([], { onCall: call => {
      if (call.command === 'npm' && call.args[1] === 'deploy:site') snapshot = call.env.CANOPY_SITE_ASSET_SNAPSHOT;
      if (call.command === process.execPath && call.args.includes('list')) {
        expected = artifactHash([join(app, '.wrangler/release-site'), snapshot]);
        rmSync(join(app, 'dist'), { recursive: true });
      }
    } }), directory, env: productionEnv, readConfig: () => mockConfig(target), record: () => {} }));
  assert.equal(evidence.artifactSha256, expected);
  assert.equal(existsSync(snapshot), false, 'Snapshot is removed after recording release evidence');
});

test('local dispatch names only the requested target and requires a clean main ancestor', () => {
  const log = [];
  withoutConsoleOutput(() => dispatchRelease('builder', { run: stubRun(log), directory: '/fixture' }));
  const workflow = log.find(call => call.command === 'gh');
  assert.deepEqual(workflow.args, ['workflow', 'run', 'deploy.yml', '--repo', 'mainbrella/web', '--ref', 'main',
    '-f', 'target=builder', '-f', `source_sha=${sourceSha}`, '-f', 'environment=production']);

  for (const status of [' M apps/web/index.html', 'UU apps/web/index.html']) {
    const rejected = [];
    assert.throws(() => dispatchRelease('site', { run: stubRun(rejected, { status }), directory: '/fixture' }), /Commit the intended release/);
    assert.deepEqual(rejected.map(call => call.args[0]), ['status']);
  }

  const unrelated = [];
  assert.throws(() => dispatchRelease('site', {
    run: stubRun(unrelated, { failOn: `git merge-base --is-ancestor ${sourceSha} FETCH_HEAD` }),
    directory: '/fixture',
  }), /stub failed/);
  assert.equal(unrelated.some(call => call.command === 'gh'), false);
});
