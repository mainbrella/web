import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { hashFiles, sealProviderEvidence, sha256, writeJson } from './evidence.ts';
import { MainbrellaAdapter } from './providers/mainbrella.ts';
import { checkCapacity } from './provider-runner.ts';
import { workerRequest } from './worker-experiment.ts';
import { makeWorkerLedger } from './worker-verifier.ts';
import type { WorkerProbe } from './worker-verifier.ts';
import type { Execution } from './providers/interface.ts';

// Separate qualification of automatic startup; it does not change the matched
// provider protocol or pretend a freshly launched worker inherits memory.
const repository = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { output: { type: 'string' } } });
assert.ok(values.output, 'Use --output <new-directory>');
assert.equal(process.versions.node, '22.22.2');
const output = resolve(values.output);
await mkdir(output, { recursive: false, mode: 0o700 });
const privateDirectory = join(output, 'private');
await mkdir(privateDirectory, { mode: 0o700 });
const apiUrl = 'https://api.mainbrella.com';
const apiKey = process.env.MAINBRELLA_API_KEY || '';
assert.ok(apiKey, 'MAINBRELLA_API_KEY is required');
const adapter = new MainbrellaAdapter({ apiUrl, apiKey, directory: privateDirectory });
const guest = '/workspace/memory-worker';
const node = '/opt/rodeo-node/bin/node';
const ledger = makeWorkerLedger(12346, randomUUID());
const recipe = { command: `${node} server.mjs`, cwd: guest,
  readiness: { port: 5173, path: '/probe', timeoutMs: 30000 } };
const result: any = { schemaVersion: 1, experiment: 'mainbrella-automatic-restore-launch', status: 'failed',
  startedAt: new Date().toISOString(), apiUrl, seed: 12346, recipe, ledger,
  runner: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() },
  source: null, restore: null, errors: [], cleanup: null,
  limitations: ['One automatic-startup qualification, not a matched provider or performance comparison.',
    'The restored worker has a fresh nonce and an empty heap; this is not live process cloning.',
    'API cleanup is checked; physical storage reclamation is not measured.'] };
const operation = (name: string, timeoutMs = 60000) => ({ name, timeoutMs });
const success = (execution: Execution) => {
  assert.equal(execution.exitCode, 0, 'Guest command failed; inspect private evidence');
  assert.equal(execution.outputTruncated, false);
  return execution.stdout;
};
try {
  const inputs = join(privateDirectory, 'inputs');
  for (const path of ['src/restore-launch-experiment.ts', 'src/providers/mainbrella.ts', 'src/worker-verifier.ts',
    'fixtures/memory-worker/server.mjs', 'fixtures/memory-worker/processor.mjs']) {
    const target = join(inputs, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(repository, path)));
  }
  result.inputHashes = await hashFiles(inputs);
  const capabilities = await (await fetch(`${apiUrl}/capabilities`, { signal: AbortSignal.timeout(10000) })).json() as any;
  assert.equal(capabilities.persistence.restoreLaunch, true);
  assert.equal(capabilities.persistence.memory, false);
  result.advertisedPersistence = capabilities.persistence;
  const before = await adapter.inventory();
  result.inventoryBefore = before;
  checkCapacity(before, 8e9);
  console.log('Mainbrella: preparing a listening source and five memory-only jobs');
  const { sandbox: source } = await adapter.create({ ...operation('launch-source-create', 180000), image: 'node', size: 'small' });
  success(await adapter.execute(source, { ...operation('launch-runtime', 300000), argv: ['/bin/sh', '-c',
    'set -eu; case "$(uname -m)" in x86_64) rodeo_arch=x64;; aarch64) rodeo_arch=arm64;; *) exit 1;; esac; ' +
    'rodeo_archive=node-v22.22.2-linux-$rodeo_arch.tar.gz; mkdir -p /tmp/rodeo-runtime /opt/rodeo-node; cd /tmp/rodeo-runtime; ' +
    'curl -fsSLO https://nodejs.org/dist/v22.22.2/$rodeo_archive; curl -fsSLO https://nodejs.org/dist/v22.22.2/SHASUMS256.txt; ' +
    'awk -v name="$rodeo_archive" \'$2 == name { print; count++ } END { if (count != 1) exit 1 }\' SHASUMS256.txt > runtime.sha256; ' +
    'sha256sum --check --status runtime.sha256; tar -xzf "$rodeo_archive" -C /opt/rodeo-node --strip-components=1;' ] }));
  success(await adapter.execute(source, { ...operation('launch-mkdir'), argv: ['mkdir', '-p', guest] }));
  for (const name of ['server.mjs', 'processor.mjs']) await adapter.upload(source, { ...operation(`launch-upload-${name}`),
    path: `${guest}/${name}`, bytes: await readFile(join(inputs, 'fixtures/memory-worker', name)) });
  success(await adapter.execute(source, { ...operation('launch-source-server'), argv: ['/bin/sh', '-c',
    `cd ${guest}; setsid ${node} server.mjs > source.log 2>&1 < /dev/null &`] }));
  const sourcePreview = await adapter.preview(source, { ...operation('launch-source-preview'), port: 5173 });
  await writeJson(join(privateDirectory, 'previews.json'), { source: sourcePreview });
  const sourceBefore = await workerRequest<WorkerProbe>(sourcePreview, '/prepare', { preparationId: ledger.preparationId, jobs: ledger.jobs });
  assert.equal(sourceBefore.pending, 5);
  assert.equal(sourceBefore.node, '22.22.2');
  result.source = { sandbox: source, beforeCapture: sourceBefore };
  console.log('Mainbrella: saving the launch recipe and restoring without a client-side launch');
  const prepared = await adapter.capture(source, { ...operation('launch-capture', 180000), mode: 'saved-workspace', launch: recipe });
  result.capture = { id: prepared.id, preservation: prepared.preservation };
  assert.deepEqual(await workerRequest(sourcePreview, '/probe'), sourceBefore);
  const { sandbox: restored } = await adapter.spawn(prepared, operation('launch-restore', 180000));
  result.restore = { sandbox: restored, clientSideLaunchCommands: 0 };
  const deadline = Date.now() + 45000;
  let descriptor: any;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/containers`, { headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const inventory = await response.json() as any;
    descriptor = inventory.containers.find((item: any) => item.id === restored.id && item.createdAt === restored.generation);
    assert.ok(descriptor);
    if (descriptor.readiness?.status === 'ready' || descriptor.readiness?.status === 'failed') break;
    await pause(500);
  }
  result.restore.readiness = descriptor?.readiness ?? null;
  assert.equal(descriptor?.readiness?.status, 'ready', 'Automatic restore did not become application-ready');
  const restoredPreview = await adapter.preview(restored, { ...operation('launch-restored-preview'), port: 5173 });
  await writeJson(join(privateDirectory, 'restored-preview.json'), restoredPreview);
  const restoredState = await workerRequest<WorkerProbe>(restoredPreview, '/probe');
  result.restore.process = restoredState;
  assert.equal(restoredState.node, '22.22.2');
  assert.notEqual(restoredState.nonce, sourceBefore.nonce);
  assert.equal(restoredState.pending, 0);
  assert.equal(restoredState.preparationId, null);
  assert.equal(restoredState.phase, 'empty');
  result.source.afterRestore = await workerRequest(sourcePreview, '/probe');
  assert.deepEqual(result.source.afterRestore, sourceBefore);
  result.status = 'completed';
} catch (error) {
  result.errors.push(error instanceof Error ? error.message.replaceAll(apiKey, '[REDACTED]') : 'Qualification failed');
} finally {
  console.log('Mainbrella: cleaning up exact qualification-owned resources');
  try {
    result.cleanup = await adapter.cleanup();
    if (!result.cleanup.confirmed) result.status = 'failed';
  } catch { result.errors.push('Cleanup could not be confirmed; use the retained ownership journal'); result.status = 'failed'; }
  try {
    const after = await adapter.inventory();
    result.inventoryAfter = after;
    if (result.inventoryBefore) {
      const identities = (items: unknown[]) => items.map(item => JSON.stringify(item)).sort();
      assert.deepEqual(identities(after.sandboxes), identities(result.inventoryBefore.sandboxes));
      assert.deepEqual(identities(after.workspaces), identities(result.inventoryBefore.workspaces));
    }
  } catch { result.errors.push('Original inventory could not be confirmed'); result.status = 'failed'; }
  result.finishedAt = new Date().toISOString();
  result.evidence = { privateDirectory: 'private', files: await sealProviderEvidence(privateDirectory) };
  await writeJson(join(output, 'result.json'), result);
  await writeFile(join(output, 'result.sha256'), `${sha256(await readFile(join(output, 'result.json')))}  result.json\n`);
}
console.log(JSON.stringify({ status: result.status, listeningAfterAutomaticRestore: result.restore?.readiness?.status === 'ready',
  pendingJobs: result.restore?.process?.pending, clientSideLaunchCommands: result.restore?.clientSideLaunchCommands,
  cleanup: result.cleanup?.confirmed ?? false, errors: result.errors }));
process.exitCode = result.status === 'completed' ? 0 : 1;
