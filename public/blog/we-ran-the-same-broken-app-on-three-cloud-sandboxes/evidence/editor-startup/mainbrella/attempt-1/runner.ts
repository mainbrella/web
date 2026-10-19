import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { snapshotInputs, sealProviderEvidence, sha256, writeJson } from './evidence.ts';
import { prepareSource } from './experiment-source.ts';
import { readScenario } from './scenario.ts';
import { MainbrellaAdapter } from './providers/mainbrella.ts';
import { checkCapacity } from './provider-runner.ts';
import type { Execution, Sandbox } from './providers/interface.ts';

// A separate readiness qualification of the article's pinned application. The
// matched repair protocol and its historical process observations stay intact.
const repository = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { output: { type: 'string' }, source: { type: 'string' } } });
assert.ok(values.output && values.source, 'Use --output <new-directory> --source <web-checkout>');
assert.equal(process.versions.node, '22.22.2');
const output = resolve(values.output);
await mkdir(output, { recursive: false, mode: 0o700 });
const privateDirectory = join(output, 'private');
await mkdir(privateDirectory, { mode: 0o700 });
const apiUrl = 'https://api.mainbrella.com';
const apiKey = process.env.MAINBRELLA_API_KEY || '';
assert.ok(apiKey, 'MAINBRELLA_API_KEY is required');
const adapter = new MainbrellaAdapter({ apiUrl, apiKey, directory: privateDirectory });
const runId = `app-restore-${randomUUID()}`;
const sourceRef = '3eb5f1d144324793492bed765d94bc6463614ef3';
const recipe = { command: 'VITE_API_URL=https://api.mainbrella.com node rodeo-server.mjs web-checkout',
  cwd: '/workspace/rodeo', readiness: { port: 5173, path: '/__rodeo_process', timeoutMs: 30000 } };
const result: any = { schemaVersion: 1, experiment: 'mainbrella-article-app-automatic-startup',
  status: 'failed', runId, startedAt: new Date().toISOString(), apiUrl, recipe,
  runner: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() },
  source: {}, copies: [], errors: [], cleanup: null,
  limitations: [
    'A separate Mainbrella automatic-startup qualification, not a matched provider or performance comparison.',
    'The pinned article application is restored three times without patches; browser repair controls are not rerun.',
    'Listening is measured after the configured readiness gate; freshly allocated containers may still be starting.',
    'Each restored process has a fresh nonce. PID equality across separate containers would not establish inherited memory.',
    'API cleanup is checked; physical storage reclamation, billing and comparative startup speed are not measured.',
    'Private API receipts and bearer previews are withheld; public inputs and observations cannot independently replay the full verification.',
  ] };
const abort = new AbortController();
const interrupted = () => abort.abort(new Error('Qualification interrupted'));
process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
const operation = (name: string, timeoutMs = 60000) => ({ name, timeoutMs, signal: abort.signal });
const success = (execution: Execution) => {
  assert.equal(execution.exitCode, 0, 'Guest command failed; inspect private evidence');
  assert.equal(execution.timedOut, false); assert.equal(execution.outputTruncated, false);
  return execution.stdout;
};
const inspect = async (sandbox: Sandbox, name: string) => JSON.parse(success(await adapter.execute(sandbox,
  { ...operation(name), argv: ['node', '/workspace/rodeo-inspect.mjs'] })));
const checkState = (actual: any, original: any) => {
  assert.deepEqual(actual.hashes, original.hashes);
  assert.equal(actual.dependencyHash, original.dependencyHash);
  assert.equal(actual.prepared, original.prepared); assert.equal(actual.mode, original.mode);
  assert.equal(actual.link, original.link); assert.equal(actual.process.serverReachable, true);
};
try {
  await writeJson(join(privateDirectory, 'connection.json'), { schemaVersion: 1, provider: 'mainbrella', apiUrl });
  const inputs = join(privateDirectory, 'inputs');
  result.inputHashes = await snapshotInputs(repository, inputs);
  const response = await fetch(`${apiUrl}/capabilities`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  assert.equal(response.status, 200);
  const capabilities = await response.json() as any;
  assert.equal(capabilities.persistence.restoreLaunch, true);
  assert.equal(capabilities.persistence.memory, false);
  result.advertisedPersistence = capabilities.persistence;
  const before = await adapter.inventory();
  result.inventoryBefore = before; checkCapacity(before, 8e9);
  const scenario = await readScenario(join(inputs, 'fixtures/editor/scenario.json'));
  const source = await prepareSource({ repository, inputs, directory: privateDirectory, scenario,
    source: values.source, sourceRef });
  assert.equal(Object.keys(source.hashes).length, 417);
  result.source = { commit: source.commit, archiveSha256: sha256(source.archive), fileCount: 417 };
  console.log('Mainbrella: preparing the article application at its original pinned commit');
  const { sandbox } = await adapter.create({ ...operation('app-source-create', 180000), image: 'node', size: 'small' });
  result.source.sandbox = sandbox;
  await adapter.upload(sandbox, { ...operation('app-source-upload', 300000), path: '/workspace/rodeo.tar.gz', bytes: source.archive });
  success(await adapter.execute(sandbox, { ...operation('app-source-extract'), argv: ['/bin/sh', '-c',
    'mkdir -p /workspace/rodeo && tar -xzf /workspace/rodeo.tar.gz -C /workspace/rodeo'] }));
  for (const [name, path, bytes] of [
    ['launcher', '/workspace/rodeo/rodeo-server.mjs', await readFile(join(inputs, 'src/guest/launch.mjs'))],
    ['inspector', '/workspace/rodeo-inspect.mjs', await readFile(join(inputs, 'src/guest/inspect.mjs'))],
    ['inventory', '/workspace/rodeo-files.json', Buffer.from(JSON.stringify(Object.keys(source.hashes)))],
  ] as const) await adapter.upload(sandbox, { ...operation(`app-source-${name}`), path, bytes });
  success(await adapter.execute(sandbox, { ...operation('app-source-install', 600000),
    argv: ['npm', 'ci', '--no-audit', '--no-fund'], cwd: recipe.cwd }));
  success(await adapter.execute(sandbox, { ...operation('app-source-typecheck', 180000),
    argv: ['npm', 'run', 'type-check'], cwd: recipe.cwd }));
  success(await adapter.execute(sandbox, { ...operation('app-source-markers'), argv: ['node', '-e',
    "const fs=require('node:fs');fs.writeFileSync('/workspace/rodeo-prepared',process.argv[1],{mode:0o755});fs.symlinkSync('/workspace/rodeo-prepared','/workspace/rodeo-link')", runId] }));
  result.guest = JSON.parse(success(await adapter.execute(sandbox, { ...operation('app-source-tools'), argv: ['node', '-e',
    "console.log(JSON.stringify({node:process.versions.node,npm:require('node:child_process').execFileSync('npm',['--version'],{encoding:'utf8'}).trim()}))"] })));
  success(await adapter.execute(sandbox, { ...operation('app-source-launch'), cwd: recipe.cwd,
    env: { VITE_API_URL: apiUrl }, argv: ['/bin/sh', '-c',
      'setsid node rodeo-server.mjs web-checkout > /workspace/rodeo-source.log 2>&1 < /dev/null &'] }));
  let original: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    original = await inspect(sandbox, `app-source-ready-${attempt}`);
    if (original.process.serverReachable) break;
    await pause(500, undefined, { signal: abort.signal });
  }
  assert.equal(original.process.serverReachable, true); assert.deepEqual(original.hashes, source.hashes);
  assert.ok(original.dependencyHash);
  result.source.beforeCapture = original;
  console.log('Mainbrella: capturing a foreground launch recipe and restoring three copies');
  const prepared = await adapter.capture(sandbox, { ...operation('app-capture', 180000), mode: 'saved-workspace', launch: recipe });
  result.capture = { id: prepared.id, bytes: prepared.bytes, preservation: prepared.preservation };
  const afterCapture = await inspect(sandbox, 'app-source-after-capture');
  checkState(afterCapture, original); assert.equal(afterCapture.process.nonce, original.process.nonce);
  assert.equal(afterCapture.process.pid, original.process.pid); result.source.afterCapture = afterCapture;
  for (const name of ['copy-1', 'copy-2', 'copy-3']) {
    const { sandbox: copy } = await adapter.spawn(prepared, operation(`app-${name}-restore`, 180000));
    const record: any = { id: name, sandbox: copy, clientSideLaunchCommands: 0 };
    result.copies.push(record);
    const deadline = Date.now() + 45000;
    let descriptor: any;
    while (Date.now() < deadline) {
      const inventoryResponse = await fetch(`${apiUrl}/containers`, {
        headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
      assert.equal(inventoryResponse.status, 200);
      const inventory = await inventoryResponse.json() as any;
      descriptor = inventory.containers.find((item: any) => item.id === copy.id && item.createdAt === copy.generation);
      assert.ok(descriptor);
      if (['ready', 'failed'].includes(descriptor.readiness?.status)) break;
      await pause(500, undefined, { signal: abort.signal });
    }
    record.readiness = descriptor?.readiness ?? null;
    assert.equal(record.readiness?.status, 'ready', 'Automatic restore did not become application-ready');
    const state = await inspect(copy, `app-${name}-initial`);
    record.observation = state;
    checkState(state, original); assert.notEqual(state.process.nonce, original.process.nonce);
    const preview = await adapter.preview(copy, { ...operation(`app-${name}-preview`), port: 5173 });
    await writeJson(join(privateDirectory, `${name}-preview.json`), preview);
    const publicResponse = await fetch(new URL('/repo-rodeo-bug', preview.url), {
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    record.previewHttpStatus = publicResponse.status;
    assert.equal(publicResponse.status, 200);
    const html = await publicResponse.text();
    assert.ok(html.includes('repo-rodeo-bug'), 'Preview did not serve the article application');
    console.log(`Mainbrella: ${name} automatically listening; 417/417 files; fresh process nonce`);
  }
  assert.equal(new Set(result.copies.map((copy: any) => copy.observation.process.nonce)).size, 3);
  result.source.afterRestores = await inspect(sandbox, 'app-source-after-restores');
  checkState(result.source.afterRestores, original);
  assert.equal(result.source.afterRestores.process.nonce, original.process.nonce);
  assert.equal(result.source.afterRestores.process.pid, original.process.pid);
  result.status = 'completed';
} catch (error) {
  result.errors.push(error instanceof Error ? error.message.replaceAll(apiKey, '[REDACTED]') : 'Qualification failed');
} finally {
  process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
  console.log('Mainbrella: cleaning up exact qualification-owned resources');
  try {
    result.cleanup = await adapter.cleanup();
    if (!result.cleanup.confirmed) result.status = 'failed';
  } catch { result.errors.push('Cleanup could not be confirmed; use retained ownership journal'); result.status = 'failed'; }
  try {
    const after = await adapter.inventory(); result.inventoryAfter = after;
    const identities = (items: unknown[]) => items.map(item => JSON.stringify(item)).sort();
    if (result.inventoryBefore) {
      assert.deepEqual(identities(after.sandboxes), identities(result.inventoryBefore.sandboxes));
      assert.deepEqual(identities(after.workspaces), identities(result.inventoryBefore.workspaces));
    }
  } catch { result.errors.push('Original inventory could not be confirmed'); result.status = 'failed'; }
  result.finishedAt = new Date().toISOString();
  result.evidence = { privateDirectory: 'private', files: await sealProviderEvidence(privateDirectory) };
  await writeJson(join(output, 'result.json'), result);
  await writeFile(join(output, 'result.sha256'), `${sha256(await readFile(join(output, 'result.json')))}  result.json\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ status: result.status, copies: result.copies.map((copy: any) => ({ id: copy.id,
  listening: copy.observation?.process.serverReachable, readiness: copy.readiness?.status,
  clientSideLaunchCommands: copy.clientSideLaunchCommands })), cleanup: result.cleanup?.confirmed ?? false, errors: result.errors }));
process.exitCode = result.status === 'completed' ? 0 : 1;
