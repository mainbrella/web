import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test('public reference manifest verifies all canonical contract copies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/references/manifest.json', import.meta.url), 'utf8'));
  for (const [name, hash] of Object.entries(manifest.files)) {
    const path = new URL(['API.md', 'SKILL.md'].includes(name) ? `../${name}` : `../public/${name}`, import.meta.url);
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, `${name} changed without docs:sync`);
  }
  const index = await readFile(new URL('../public/references/index.md', import.meta.url), 'utf8');
  for (const match of index.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(manifest.files[`references/${match[1]}`], `Unindexed reference: ${match[1]}`);
});

test('installable skill archive contains the public contract and every indexed reference', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/references/manifest.json', import.meta.url), 'utf8'));
  const archive = new URL(`../public/skills/mainbrella-containers-${manifest.version}.tar.gz`, import.meta.url);
  const listing = execFileSync('tar', ['-tzf', archive.pathname], { encoding: 'utf8' }).split('\n');
  for (const name of ['API.md', 'SKILL.md', ...Object.keys(manifest.files).filter(file => file.startsWith('references/'))]) {
    assert.ok(listing.includes(`mainbrella-containers/${name}`));
    const content = execFileSync('tar', ['-xOzf', archive.pathname, `mainbrella-containers/${name}`]);
    assert.equal(createHash('sha256').update(content).digest('hex'), manifest.files[name]);
  }
  assert.ok(listing.includes('mainbrella-containers/LICENSE'));
  assert.equal(createHash('sha256').update(execFileSync('tar', ['-xOzf', archive.pathname, 'mainbrella-containers/LICENSE'])).digest('hex'), manifest.licenseSha256);
  assert.ok(listing.every(name => name === '' || name.startsWith('mainbrella-containers/')));
});
