import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { deploy, cleanup, requester, chunkSize, serverSource } from './mainbrella-deploy-static.mjs';

const owned = { id: 'small', createdAt: '2026-10-06T00:00:00.000Z', status: 'running' };
const other = { ...owned, createdAt: '2026-10-06T00:01:00.000Z' };
const ok = stdout => ({ stdout: stdout || '', stderr: '', exitCode: 0, timedOut: false, outputTruncated: false });
function fixture({ failure, lostPut, lostCreate, missingCaps, lostPreview } = {}) {
  const state = { stateFile: '/private/state.json' }, saves = [], calls = [], files = new Map();
  let creates = 0;
  const index = Buffer.from('<h1>static deployment</h1>');
  const preview = { id: 'preview-one', createdAt: owned.createdAt, url: 'https://bearer-preview.example/', expiresAt: Date.now() + 600_000 };
  const request = async (path, method = 'GET', body, headers) => {
    calls.push({ path, method, body, headers });
    if (path === '/capabilities') return { execution: { foreground: true }, files: { read: true, write: true, binary: true }, previews: { supported: !missingCaps } };
    if (path === '/containers' && method === 'GET') return { active: true, containers: [], imageCatalog: [{ id: 'node' }], limits: { maxContainers: 2, maxStartsPerMonth: 10 }, usage: { starts: 0 } };
    if (path === '/containers' && method === 'POST') {
      assert.equal(saves.at(-1).creationKey, headers['Idempotency-Key']);
      assert.deepEqual(saves.at(-1).creationBody, { catalogId: 'node', size: 'lite' });
      if (lostCreate && ++creates === 1) throw new Error('lost response');
      return { creation: { status: 'running', containerId: owned.id, createdAt: owned.createdAt }, containers: [other, owned] };
    }
    const url = new URL(path, 'https://api.example');
    assert.equal(url.searchParams.get('id'), owned.id);
    assert.equal(url.searchParams.get('createdAt'), owned.createdAt);
    if (path.startsWith('/containers/files?')) {
      const name = url.searchParams.get('path');
      if (method === 'GET') return files.get(name);
      assert.ok(body.length <= chunkSize);
      files.set(name, body);
      if (lostPut && name.endsWith('part-000000')) throw new Error('uncertain upload');
      return { size: body.length };
    }
    if (path.startsWith('/containers/exec?')) {
      if (body.command.includes('subarray(-8192)')) return ok('private diagnostic');
      assert.equal(saves.at(-1).lastCommand.pending, true);
      if (failure === state.step) return { stdout: '', stderr: 'specific command failure', exitCode: null, timedOut: true, outputTruncated: false };
      if (state.step === 'assemble') {
        const parts = [...files.entries()].filter(([name]) => name.includes('/part-')).sort().map(([,bytes]) => bytes);
        assert.equal(createHash('sha256').update(Buffer.concat(parts)).digest('hex'), state.archive.sha256);
      }
      if (state.step === 'start-server') assert.match(body.command, /^setsid nohup node .* < \/dev\/null &$/);
      return ok();
    }
    if (path.startsWith('/containers/previews?')) {
      assert.equal(state.step, 'creating-preview'); assert.equal(saves.at(-1).previewPending, true);
      if (lostPreview) throw new Error('lost preview response');
      return preview;
    }
    throw new Error('Unexpected request');
  };
  return { state, saves, calls, files, options: { state, index, archive: randomBytes(13 * 1024 * 1024 + 123), request,
    save: async state => saves.push(structuredClone(state)), wait: async () => {},
    fetcher: async url => new URL(url).pathname.startsWith('/__mainbrella_missing_') ? new Response('', { status: 404 }) : new Response(index) } };
}

test('13 MiB upload, same-key creation recovery and ambiguous PUT reconciliation use one generation', async () => {
  const f = fixture({ lostPut: true, lostCreate: true });
  const report = await deploy(f.options);
  assert.equal(report.ok, true);
  assert.equal(report.expiresAt, new Date(f.state.preview.expiresAt).toISOString());
  assert.equal('url' in report, false);
  assert.equal(JSON.stringify(report).includes('bearer-preview'), false);
  assert.equal(f.state.step, 'completed');
  assert.equal(f.state.archive.chunks, 14);
  const starts = f.calls.filter(c => c.path === '/containers' && c.method === 'POST');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].headers['Idempotency-Key'], starts[1].headers['Idempotency-Key']);
  assert.equal(f.calls.filter(c => c.method === 'PUT' && c.path.includes('part-000000')).length, 1);
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);
});

test('command failure retains flags, output and logs before explicit exact-generation cleanup', async () => {
  const f = fixture({ failure: 'readiness' });
  const report = await deploy(f.options);
  assert.equal(report.ok, false);
  assert.equal(report.step, 'readiness');
  assert.equal(f.state.lastCommand.result.timedOut, true);
  assert.equal(f.state.lastCommand.result.exitCode, null);
  assert.equal(f.state.lastCommand.result.stderr, 'specific command failure');
  assert.equal(f.state.serverLog.stdout, 'private diagnostic');
  assert.equal(f.calls.some(c => c.path.startsWith('/containers/previews')), false);
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);
  assert.equal((await cleanup({ state: f.state, save: f.options.save, request: async (path, method) => {
    assert.equal(method, 'DELETE');
    const query = new URL(path, 'https://api.example').searchParams;
    assert.equal(query.get('createdAt'), owned.createdAt);
    return { containers: [other] };
  } })).cleanup, 'completed');
});

test('missing preview capability blocks starts; uncertain previews are never retried', async () => {
  const blocked = fixture({ missingCaps: true });
  assert.equal((await deploy(blocked.options)).ok, false);
  assert.equal(blocked.calls.some(c => c.method === 'POST'), false);
  const f = fixture({ lostPreview: true });
  assert.equal((await deploy(f.options)).ok, false);
  assert.equal(f.state.previewPending, true);
  assert.equal(f.calls.filter(c => c.path.startsWith('/containers/previews?')).length, 1);
});

test('preview verification checks content, assets, directory redirects and 404s', async () => {
  const f = fixture();
  f.options.checks = [{ path: '/', bytes: f.options.index }, { path: '/download/', bytes: Buffer.from('download'), redirectFrom: '/download' }, { path: '/app.js', bytes: Buffer.from('js') }];
  f.options.fetcher = async url => {
    const path = new URL(url).pathname;
    if (path === '/download') return new Response('', { status: 308, headers: { Location: '/download/' } });
    return new Response(f.options.checks.find(c => c.path === path)?.bytes || '', { status: path.startsWith('/__') ? 404 : 200 });
  };
  assert.equal((await deploy(f.options)).ok, true);
  assert.deepEqual(f.state.verifiedPaths, ['/', '/download/', '/app.js']);
  f.options.fetcher = async () => new Response('wrong content');
  assert.equal((await deploy(f.options)).ok, false);
});

test('requester sanitizes errors while retaining documented codes and preview reconciliation identity', async () => {
  const previewId = '11111111-1111-4111-8111-111111111111';
  for (const body of [{ error: 'private-secret', message: 'mb_secret' }, { error: 'preview_reconciliation_required', previewId }]) {
    const request = requester({ base: 'https://api.example', key: 'mb_secret', fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer mb_secret');
      return Response.json(body, { status: 503 });
    } });
    await assert.rejects(request('/containers'), error => {
      assert.equal(error.status, 503);
      assert.equal(error.code, body.error === 'private-secret' ? 'request_failed' : body.error);
      assert.equal(error.previewId, body.previewId);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});

test('static server actually serves bytes, redirects, HEAD and MIME while rejecting escaped links', async t => {
  const work = await mkdtemp(join(tmpdir(), 'mainbrella-server-test-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const site = join(work, 'site'); await mkdir(join(site, 'download'), { recursive: true });
  await writeFile(join(site, 'index.html'), '<h1>Hello</h1>');
  await writeFile(join(site, 'download/index.html'), 'download');
  await writeFile(join(site, 'app.js'), 'console.log(1)');
  await writeFile(join(work, 'secret'), 'private'); await symlink(join(work, 'secret'), join(site, 'link'));
  const server = join(work, 'server.cjs');
  await writeFile(server, serverSource.replace(".listen(Number(process.argv[3]), '0.0.0.0');", ".listen(0, '127.0.0.1', function(){console.log(this.address().port)});"));
  const child = spawn(process.execPath, [server, site], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); if (child.exitCode === null) await once(child, 'exit'); });
  const [output] = await once(child.stdout, 'data');
  const base = `http://127.0.0.1:${Number(output.toString().trim())}`;
  assert.equal(await (await fetch(base)).text(), '<h1>Hello</h1>');
  assert.equal((await fetch(base + '/app.js')).headers.get('content-type'), 'text/javascript');
  const redirect = await fetch(base + '/download?x=1', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/download/?x=1');
  assert.equal(await (await fetch(base + '/download/')).text(), 'download');
  assert.equal(await (await fetch(base, { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/link')).status, 403);
  assert.equal((await fetch(base + '/%2e%2e%2fsecret')).status, 403);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});

test('actual assembly command rejects corrupt chunks before extracting', async t => {
  const work = await mkdtemp(join(tmpdir(), 'mainbrella-archive-test-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const site = join(work, 'site'); await mkdir(site); await writeFile(join(site, 'index.html'), 'archive-test');
  const archive = join(work, 'archive.tar.gz'); execFileSync('tar', ['-czf', archive, '-C', site, '.']);
  const f = fixture(); f.options.archive = await readFile(archive);
  const original = f.options.request;
  let remoteDir;
  f.options.request = async (path, method, body, headers) => {
    const result = await original(path, method, body, headers);
    if (f.state.step === 'assemble' && body?.command) {
      remoteDir = f.state.remoteDir; await mkdir(remoteDir + '/site', { recursive: true });
      t.after(() => rm(remoteDir, { recursive: true, force: true }));
      for (const [name, bytes] of f.files) await writeFile(name, bytes);
      execFileSync('/bin/sh', ['-c', body.command]);
      assert.equal(await readFile(remoteDir + '/site/index.html', 'utf8'), 'archive-test');
      await writeFile(remoteDir + '/part-000000', 'corrupt');
      assert.throws(() => execFileSync('/bin/sh', ['-c', body.command], { stdio: 'pipe' }));
    }
    return result;
  };
  assert.equal((await deploy(f.options)).ok, true);
});
