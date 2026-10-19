import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkBuild } from './check-build.mjs';

async function artifact(t, manifest, files) {
  const directory = await mkdtemp(join(tmpdir(), 'mainbrella-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ['.vite/manifest.json', ...files]) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), file.endsWith('manifest.json') ? JSON.stringify(manifest) : '');
  }
  return directory;
}

test('builder artifacts include every dynamic grammar in their own namespace', async t => {
  const entry = { file: 'build/assets/app.js', isEntry: true, css: ['build/assets/app.css'], dynamicImports: ['grammar'] };
  const manifest = { 'build/index.html': entry, grammar: { file: 'build/assets/grammar.js' } };
  const directory = await artifact(t, manifest, ['build/index.html', entry.file, ...entry.css, 'build/assets/grammar.js']);
  await checkBuild('builder', directory);
  await rm(join(directory, 'build/assets/grammar.js'));
  await assert.rejects(checkBuild('builder', directory), /ENOENT/);
});

test('builder artifacts cannot rely on chunks belonging to the site', async t => {
  const manifest = { 'build/index.html': { file: 'assets/app.js', isEntry: true } };
  const directory = await artifact(t, manifest, ['build/index.html', 'assets/app.js']);
  await assert.rejects(checkBuild('builder', directory), /another deployment/);
});

test('builder HTML cannot rely on the site for styles or images', async t => {
  const manifest = { 'build/index.html': { file: 'build/assets/app.js', isEntry: true } };
  const directory = await artifact(t, manifest, ['build/index.html', 'build/assets/app.js']);
  await writeFile(join(directory, 'build/index.html'), '<link rel="stylesheet" href="/mainbrella.css">');
  await assert.rejects(checkBuild('builder', directory), /resource belongs to another deployment/);
});

test('site artifacts require a project code entry when bundling syntax grammars', async t => {
  const manifest = { 'dashboard/index.html': { file: 'assets/dashboard.js', isEntry: true },
    'node_modules/@shikijs/langs/dist/cpp.mjs': { file: 'assets/cpp.js' } };
  const directory = await artifact(t, manifest, ['assets/dashboard.js', 'assets/cpp.js']);
  await assert.rejects(checkBuild('site', directory), /Syntax grammars/);
});


test('site code pages can share syntax grammars without bundling the Builder workspace', async t => {
  const manifest = {
    'dashboard/index.html': { file: 'assets/dashboard.js', isEntry: true },
    'projects/code/index.html': { file: 'assets/code.js', isEntry: true, dynamicImports: ['node_modules/@shikijs/langs/dist/cpp.mjs'] },
    'node_modules/@shikijs/langs/dist/cpp.mjs': { file: 'assets/cpp.js' },
  };
  const directory = await artifact(t, manifest, ['index.html', 'login/index.html', 'dashboard/index.html', 'projects/code/index.html', 'assets/dashboard.js', 'assets/code.js', 'assets/cpp.js']);
  for (const page of ['index.html', 'login/index.html', 'dashboard/index.html', 'projects/code/index.html']) await writeFile(join(directory, page), '<html><body>Page</body></html>');
  await checkBuild('site', directory);
  manifest['src/build-dashboard.ts'] = { file: 'assets/build-dashboard.js' };
  await writeFile(join(directory, '.vite/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(checkBuild('site', directory), /builder workspace/);
});

test('site checks reject missing route HTML even if the manifest and JavaScript remain', async t => {
  const manifest = { 'dashboard/index.html': { file: 'assets/dashboard.js', isEntry: true } };
  const directory = await artifact(t, manifest, ['index.html', 'login/index.html', 'assets/dashboard.js']);
  for (const page of ['index.html', 'login/index.html']) await writeFile(join(directory, page), '<html><body>Page</body></html>');
  await assert.rejects(checkBuild('site', directory), /dashboard\/index.html/);
});

test('site checks reject HTML referring to chunks from a different build', async t => {
  const manifest = { 'dashboard/index.html': { file: 'assets/dashboard.js', isEntry: true } };
  const directory = await artifact(t, manifest, ['index.html', 'login/index.html', 'dashboard/index.html', 'assets/dashboard.js']);
  for (const page of ['index.html', 'login/index.html', 'dashboard/index.html']) await writeFile(join(directory, page), '<html><script src="/assets/old.js"></script></html>');
  await assert.rejects(checkBuild('site', directory), /assets\/old.js/);
});
