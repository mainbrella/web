import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

// Read sealed local records only. This script never contacts a provider or
// copies private receipts, browser traces, preview URLs, or credentials.
const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryPath = process.argv[2] || process.env.REPO_RODEO_PATH;
if (!repositoryPath) throw new Error('Set REPO_RODEO_PATH or pass the repo-rodeo checkout as the first argument.');
const repository = resolve(repositoryPath);
const output = join(web, 'public/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const files = {};
const secrets = new Set();
let sealedFilesChecked = 0;
const verifiedResults = new Map();
for (const [name, value] of Object.entries(process.env)) {
  if (/_API_KEY$/.test(name) && value) secrets.add(value);
}

function collectSecrets(value, key = '') {
  if (typeof value === 'string') {
    if (/^(apiKey|authorization|cookie|set-cookie|url|.*token|.*secret)$/i.test(key) && value.length > 8) secrets.add(value);
    if (key === 'responseBody') {
      try { collectSecrets(JSON.parse(value)); } catch { /* Not every receipt body is JSON. */ }
    }
  } else if (Array.isArray(value)) value.forEach(item => collectSecrets(item, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => collectSecrets(item, name));
}
for (const path of [join(web, '../backend/.env'), join(repository, '.env')]) {
  try {
    for (const [name, value] of Object.entries(parseEnv(await readFile(path, 'utf8')))) {
      if (/_API_KEY$/.test(name) && value) secrets.add(value);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function scan(bytes) {
  for (const value of secrets) assert.ok(!bytes.includes(Buffer.from(value)), 'Public export contains a retained credential or preview URL');
}
async function put(path, bytes) {
  scan(bytes);
  await mkdir(dirname(join(output, path)), { recursive: true });
  await writeFile(join(output, path), bytes);
  files[path] = hash(bytes);
}
const putJson = (path, data) => put(path, Buffer.from(`${JSON.stringify(data, null, 2)}\n`));
async function checkResult(root) {
  if (verifiedResults.has(root)) return verifiedResults.get(root);
  const bytes = await readFile(join(root, 'result.json'));
  assert.equal((await readFile(join(root, 'result.sha256'), 'utf8')).split(/\s/)[0], hash(bytes));
  const result = JSON.parse(bytes);
  for (const [path, digest] of Object.entries(result.evidence.files)) {
    const receipt = await readFile(join(root, result.evidence.privateDirectory, path));
    assert.equal(hash(receipt), digest, `Sealed evidence changed: ${path}`);
    if (path.endsWith('.json') && !path.startsWith('inputs/')) collectSecrets(JSON.parse(receipt));
    sealedFilesChecked++;
  }
  const checked = { bytes, result, sha256: hash(bytes) };
  verifiedResults.set(root, checked);
  return checked;
}

const selected = {
  mainbrella: 'worker-mainbrella-postdeploy-review-2026-10-12T11-23-18-505Z',
  e2b: 'worker-e2b-20261012-03',
  daytona: 'worker-daytona-20261012-02',
};
const core = ['fixtures/memory-worker/server.mjs', 'fixtures/memory-worker/processor.mjs',
  'fixtures/memory-worker/correct.mjs', 'fixtures/memory-worker/misleading.mjs',
  'src/worker-experiment.ts', 'src/worker-verifier.ts', 'tests/worker-experiment.test.ts',
  'package.json', 'package-lock.json', '.node-version'];
const reference = await json(join(repository, 'artifacts', selected.e2b, 'result.json'));
const verifierPath = join(repository, 'artifacts', selected.e2b, 'private/inputs/src/worker-verifier.ts');
assert.equal(hash(await readFile(verifierPath)), reference.inputHashes['src/worker-verifier.ts']);
const { makeWorkerLedger, verifyWorker } = await import(pathToFileURL(verifierPath).href);
const workerRuns = [];
for (const [provider, directory] of Object.entries(selected)) {
  const root = join(repository, 'artifacts', directory);
  const { bytes, result, sha256 } = await checkResult(root);
  assert.equal(result.status, 'completed');
  assert.equal(result.provider, provider);
  assert.equal(result.seed, 12346);
  assert.equal(result.guestNode, '22.22.2');
  assert.equal(result.cleanup.confirmed, true);
  assert.equal(result.isolation.status, 'verified');
  assert.deepEqual(result.ledger, makeWorkerLedger(result.seed, result.ledger.preparationId));
  for (const [path, digest] of Object.entries(result.inputHashes)) {
    assert.equal(hash(await readFile(join(root, 'private/inputs', path))), digest);
  }
  for (const path of core) assert.equal(result.inputHashes[path], reference.inputHashes[path], `Worker workload differs: ${path}`);
  for (const branch of result.branches) {
    assert.deepEqual(branch.verification, verifyWorker(result.ledger, branch.beforeResume, branch.after));
    const expected = provider === 'e2b' ? branch.id === 'correct' ? 'passed' : 'rejected' : 'reproduction-lost';
    assert.equal(branch.verification.status, expected);
  }
  assert.deepEqual(result.coldRestart.verification,
    verifyWorker(result.ledger, result.coldRestart.fresh.process, result.coldRestart.after));
  assert.equal(result.coldRestart.verification.status, 'reproduction-lost');
  await put(`worker/${provider}/result.json`, bytes);
  await put(`worker/${provider}/result.sha256`, await readFile(join(root, 'result.sha256')));
  for (const [path, expected] of Object.entries({
    'source-prepared.json': result.source.prepared,
    'source-after-capture.json': result.source.afterCapture,
    'source-after-isolation.json': result.source.afterIsolation,
    ...Object.fromEntries(result.branches.map(branch => [`branch-${branch.id}.json`, branch])),
    'cold-restart.json': result.coldRestart,
  })) {
    const observation = await readFile(join(root, path));
    assert.deepEqual(JSON.parse(observation), expected);
    await put(`worker/${provider}/${path}`, observation);
  }
  workerRuns.push({ provider, directory, result: `worker/${provider}/result.json`, sha256,
    seed: result.seed, guestNode: result.guestNode, runner: result.runner,
    controls: result.branches.map(branch => ({ id: branch.id, before: branch.beforeResume,
      receiptCount: branch.verification.actualCount, verification: branch.verification.status })),
    coldRestart: result.coldRestart.verification.status, apiCleanupConfirmed: result.cleanup.confirmed });
}

const history = [];
for (const directory of (await readdir(join(repository, 'artifacts'))).filter(name => name.startsWith('worker-')).sort()) {
  let record;
  try { record = await checkResult(join(repository, 'artifacts', directory)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const { result, sha256 } = record;
  const failureObservations = [];
  if (result.status !== 'completed') {
    for (const [path, digest] of Object.entries(result.evidence.files)) {
      if (!path.startsWith('journal-snapshot/operations/')) continue;
      const receipt = await json(join(repository, 'artifacts', directory, 'private', path));
      if (receipt.status !== 429) continue;
      const body = JSON.parse(receipt.responseBody);
      failureObservations.push({ operation: receipt.name, httpStatus: receipt.status,
        errorCode: body.error, retryAfterSeconds: body.retryAfterSeconds ?? null,
        sealedReceipt: { path, sha256: digest } });
    }
  }
  history.push({ directory, sha256, provider: result.provider, seed: result.seed, status: result.status,
    startedAt: result.startedAt, finishedAt: result.finishedAt, runner: result.runner,
    controls: result.branches.map(branch => ({ id: branch.id, status: branch.verification?.status ?? 'unverified',
      receipts: branch.verification?.actualCount ?? null })),
    coldRestart: result.coldRestart?.verification.status ?? 'unverified',
    apiCleanupConfirmed: result.cleanup?.confirmed ?? false, errors: result.errors, failureObservations });
  if (result.status !== 'completed') {
    await put(`worker/${result.provider}-incomplete/result.json`, record.bytes);
    await put(`worker/${result.provider}-incomplete/result.sha256`,
      await readFile(join(repository, 'artifacts', directory, 'result.sha256')));
  }
}
await putJson('worker/run-history.json', { schemaVersion: 1,
  description: 'All retained volatile-worker attempts, including the incomplete Mainbrella execution-history-limit run. Repetitions are controls, not a reliability sample.',
  runs: history });

const sourceDirectory = join(repository, 'examples/memory-worker');
const sourceManifest = await json(join(sourceDirectory, 'source-manifest.json'));
assert.deepEqual(sourceManifest.files, reference.inputHashes);
const archive = await readFile(join(sourceDirectory, 'source.tar.gz'));
assert.equal(hash(archive), sourceManifest.archiveSha256);
const archiveFiles = execFileSync('tar', ['-tzf', join(sourceDirectory, 'source.tar.gz')], { encoding: 'utf8' })
  .trim().split('\n').filter(path => !path.endsWith('/'));
const packagingFiles = {};
assert.deepEqual(archiveFiles.map(path => path.replace(/^\.\//, '')).sort(),
  [...Object.keys(sourceManifest.files), 'README.md', 'SOURCE-MANIFEST.json'].sort());
for (const path of archiveFiles) {
  const bytes = execFileSync('tar', ['-xOzf', join(sourceDirectory, 'source.tar.gz'), path], { maxBuffer: 1024 * 1024 });
  const name = path.replace(/^\.\//, '');
  if (sourceManifest.files[name]) assert.equal(hash(bytes), sourceManifest.files[name], `Archived worker input changed: ${path}`);
  else packagingFiles[name] = hash(bytes);
  if (name === 'SOURCE-MANIFEST.json') assert.deepEqual(JSON.parse(bytes).files, sourceManifest.files);
}
scan(execFileSync('tar', ['-xOzf', join(sourceDirectory, 'source.tar.gz')], { maxBuffer: 5 * 1024 * 1024 }));
await put('worker/source.tar.gz', archive);
await putJson('worker/source-manifest.json', { ...sourceManifest, packagingFiles,
  description: 'Exact 35 retained inputs for the selected E2B worker run. The three selected providers share the fixture, patches, worker runner and verifier bytes. Each result identifies its own complete input hashes and Git provenance.' });

const cleanupRuns = [];
for (const provider of Object.keys(selected)) {
  const source = join(repository, 'examples', `${provider}-matched-followup`);
  const root = join(repository, 'artifacts', `matched-${provider}-20261012`);
  const { result, sha256 } = await checkResult(join(root, 'editor'));
  const followupBytes = await readFile(join(source, 'followup.json'));
  assert.deepEqual(followupBytes, await readFile(join(root, 'followup.json')));
  assert.equal((await readFile(join(source, 'followup.sha256'), 'utf8')).split(/\s/)[0], hash(followupBytes));
  const followup = JSON.parse(followupBytes);
  const observations = await json(join(source, 'preview-observations.json'));
  assert.equal(observations.sourceSha256, hash(followupBytes));
  assert.equal(observations.apiCleanupConfirmed, true);
  assert.equal(observations.inventoryRestoredExactly, true);
  for (const probe of observations.probes) {
    assert.equal(probe.beforeCleanup.withCredential, 200);
    assert.equal(probe.rounds.length, 3);
    probe.rounds.forEach(round => assert.equal(round.liveControl, 200));
  }
  for (const [path, digest] of Object.entries(followup.runner.inputHashes)) {
    assert.equal(hash(await readFile(join(root, 'editor/private/inputs', path))), digest);
  }
  for (const path of ['result.json', 'result.sha256', 'followup.json', 'followup.sha256',
    'preview-observations.json', 'evidence-validation.json']) {
    const bytes = await readFile(join(source, path));
    if (path === 'result.json') assert.equal(hash(bytes), sha256);
    await put(`matched/${provider}/${path}`, bytes);
  }
  for (const [path, digest] of Object.entries(result.evidence.publicObservations)) {
    const bytes = await readFile(join(source, 'observations', path));
    assert.equal(hash(bytes), digest);
    await put(`matched/${provider}/observations/${path}`, bytes);
  }
  cleanupRuns.push({ provider, result: `matched/${provider}/result.json`, sha256,
    followup: `matched/${provider}/followup.json`, followupSha256: hash(followupBytes),
    observations: `matched/${provider}/preview-observations.json`,
    apiCleanupConfirmed: true, inventoryRestoredExactly: true,
    previewApplicationAccess: observations.previewApplicationAccess,
    independentTokenInvalidationAfterDeletion: observations.independentTokenInvalidation,
    physicalStorage: observations.physicalStorage });
}

const launchRoot = join(repository, 'artifacts/mainbrella-restore-launch-2026-10-12T12-08-25-536Z');
const launch = await checkResult(launchRoot);
assert.equal(launch.result.status, 'completed');
assert.equal(launch.result.restore.readiness.status, 'ready');
assert.equal(launch.result.restore.clientSideLaunchCommands, 0);
assert.notEqual(launch.result.restore.process.nonce, launch.result.source.beforeCapture.nonce);
assert.equal(launch.result.restore.process.pending, 0);
assert.equal(launch.result.source.afterRestore.pending, 5);
assert.equal(launch.result.cleanup.confirmed, true);
for (const [path, digest] of Object.entries(launch.result.inputHashes)) {
  assert.equal(hash(await readFile(join(launchRoot, 'private/inputs', path))), digest);
  await put(`restore-launch/mainbrella/inputs/${path}`, await readFile(join(launchRoot, 'private/inputs', path)));
}
await put('restore-launch/mainbrella/result.json', launch.bytes);
await put('restore-launch/mainbrella/result.sha256', await readFile(join(launchRoot, 'result.sha256')));

const appLaunchRoot = join(repository, 'artifacts/mainbrella-app-restore-launch-2026-10-12T13-21-44-060Z');
const appLaunch = await checkResult(appLaunchRoot);
assert.equal(appLaunch.result.experiment, 'mainbrella-article-app-automatic-startup');
assert.equal(appLaunch.result.status, 'completed');
assert.equal(appLaunch.result.source.commit, '3eb5f1d144324793492bed765d94bc6463614ef3');
const originalEditor = await json(join(web, 'public/blog/one-bug-three-clouds/mainbrella-production/result.json'));
assert.equal(appLaunch.result.source.archiveSha256, originalEditor.source.archiveSha256);
assert.equal(appLaunch.result.source.fileCount, 417);
assert.equal(appLaunch.result.cleanup.confirmed, true);
const originalApp = appLaunch.result.source.beforeCapture;
assert.equal(originalApp.process.serverReachable, true);
assert.equal(Object.keys(originalApp.hashes).length, 417);
assert.deepEqual(appLaunch.result.copies.map(copy => copy.id), ['copy-1', 'copy-2', 'copy-3']);
for (const copy of appLaunch.result.copies) {
  assert.equal(copy.readiness.status, 'ready');
  assert.equal(copy.clientSideLaunchCommands, 0);
  assert.equal(copy.previewHttpStatus, 200);
  assert.equal(copy.observation.process.serverReachable, true);
  assert.notEqual(copy.observation.process.nonce, originalApp.process.nonce);
  for (const field of ['hashes', 'dependencyHash', 'prepared', 'mode', 'link']) {
    assert.deepEqual(copy.observation[field], originalApp[field]);
  }
}
assert.equal(new Set(appLaunch.result.copies.map(copy => copy.observation.process.nonce)).size, 3);
for (const state of [appLaunch.result.source.afterCapture, appLaunch.result.source.afterRestores]) {
  assert.equal(state.process.serverReachable, true);
  assert.equal(state.process.nonce, originalApp.process.nonce);
  assert.equal(state.process.pid, originalApp.process.pid);
}
for (const [path, digest] of Object.entries(appLaunch.result.inputHashes)) {
  assert.equal(hash(await readFile(join(appLaunchRoot, 'private/inputs', path))), digest);
}
for (const path of ['src/app-restore-launch-experiment.ts', 'src/guest/launch.mjs',
  'src/guest/inspect.mjs', 'src/experiment-source.ts']) {
  await put(`editor-startup/mainbrella/inputs/${path}`, await readFile(join(appLaunchRoot, 'private/inputs', path)));
}
await put('editor-startup/mainbrella/result.json', appLaunch.bytes);
await put('editor-startup/mainbrella/result.sha256', await readFile(join(appLaunchRoot, 'result.sha256')));
const appLaunchHistory = [];
for (const [attempt, directory] of [
  ['attempt-1', 'mainbrella-app-restore-launch-2026-10-12T13-17-13-044Z'],
  ['attempt-2', 'mainbrella-app-restore-launch-2026-10-12T13-19-16-255Z'],
]) {
  const root = join(repository, 'artifacts', directory);
  const prior = await checkResult(root);
  assert.equal(prior.result.status, 'failed');
  assert.equal(prior.result.cleanup.confirmed, true);
  const path = `editor-startup/mainbrella/${attempt}`;
  await put(`${path}/result.json`, prior.bytes);
  await put(`${path}/result.sha256`, await readFile(join(root, 'result.sha256')));
  await put(`${path}/runner.ts`, await readFile(join(root, 'private/inputs/src/app-restore-launch-experiment.ts')));
  appLaunchHistory.push({ result: `${path}/result.json`, sha256: prior.sha256, status: 'failed', cleanupConfirmed: true,
    reason: 'First copy was automatically listening; the verifier rejected the app route’s canonical trailing-slash redirect. The successful run requests /repo-rodeo-bug/ directly.' });
}

// Scan once more after collecting credentials from every selected/history run.
for (const path of Object.keys(files)) scan(await readFile(join(output, path)));
await putJson('followups.json', { schemaVersion: 1, worker: { seed: 12346, guestNode: '22.22.2',
  sharedInputHashes: Object.fromEntries(core.map(path => [path, reference.inputHashes[path]])), runs: workerRuns,
  sourceArchive: 'worker/source.tar.gz', sourceManifest: 'worker/source-manifest.json', history: 'worker/run-history.json' },
  matchedEditorAndCleanup: cleanupRuns,
  automaticRestoreLaunch: { provider: 'mainbrella', result: 'restore-launch/mainbrella/result.json',
    sha256: launch.sha256, listening: true, clientSideLaunchCommands: 0, memoryPreserved: false,
    limitation: 'Separate production qualification of saved launch recipes, not a matched provider comparison.' },
  editorAutomaticStartup: { provider: 'mainbrella', result: 'editor-startup/mainbrella/result.json',
    sha256: appLaunch.sha256, copies: 3, listening: 3, clientSideLaunchCommands: 0, memoryPreserved: false,
    history: appLaunchHistory,
    limitation: 'Later startup-only check of the same pinned editor app; no patches or browser repair controls rerun.' },
  validation: { sealedPrivateFilesChecked: sealedFilesChecked,
    workerVerdictsRecomputed: true, retainedCredentialScanPassed: true }, files,
  limitation: 'These are reported observations with locally verified hashes, not independent attestations. Public editor bundles cannot replay the original strict verification without private browser traces and screenshots. No cleanup record establishes physical storage reclamation.' });
console.log(JSON.stringify({ output, filesExported: Object.keys(files).length, sealedFilesChecked,
  selectedWorkerRuns: workerRuns.length, matchedCleanupRuns: cleanupRuns.length, credentialScanPassed: true }));
