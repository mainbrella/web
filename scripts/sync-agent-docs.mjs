import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let check = false, backend = join(root, '../backend');
while (args.length) {
  const argument = args.shift();
  if (argument === '--check' && !check) check = true;
  else if (argument === '--backend' && args.length && !args[0].startsWith('--')) backend = args.shift();
  else throw new Error('Usage: node scripts/sync-agent-docs.mjs [--check] [--backend <checkout>]');
}
backend = resolve(backend);
const work = await mkdtemp(join(tmpdir(), 'mainbrella-reference-'));
try {
  const bundle = join(work, 'bundle');
  execFileSync(process.execPath, [join(backend, 'scripts/build-agent-reference.mjs'), '--out', bundle], { stdio: 'inherit' });
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  for (const [name, hash] of Object.entries(manifest.files)) {
    const source = name === 'llms-full.txt' ? join(bundle, name) : name.startsWith('references/')
      ? join(bundle, 'mainbrella-containers', name) : join(backend, name.replace(/^sdk\/(javascript|python)\.md$/, 'sdk/$1/README.md'));
    const target = join(root, ['API.md', 'SKILL.md'].includes(name) ? name : `public/${name}`);
    const bytes = await readFile(source);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Source hash mismatch: ${name}`);
    if (check) {
      if (createHash('sha256').update(await readFile(target)).digest('hex') !== hash) throw new Error(`Public document drift: ${name}; run npm run docs:sync`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
  const manifestPath = join(root, 'public/references/manifest.json');
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (check) {
    if (await readFile(manifestPath, 'utf8') !== manifestText) throw new Error('Reference manifest drift');
    const archive = join(root, 'public/skills', `mainbrella-containers-${manifest.version}.tar.gz`);
    for (const [name, hash] of Object.entries({ ...Object.fromEntries(Object.entries(manifest.files).filter(([name]) => ['API.md', 'SKILL.md'].includes(name) || name.startsWith('references/'))), LICENSE: manifest.licenseSha256 })) {
      const bytes = execFileSync('tar', ['-xOzf', archive, `mainbrella-containers/${name}`]);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Skill archive drift: ${name}; run npm run docs:sync`);
    }
  } else {
    await writeFile(manifestPath, manifestText);
    const file = `mainbrella-containers-${manifest.version}.tar.gz`;
    await mkdir(join(root, 'public/skills'), { recursive: true });
    await copyFile(join(bundle, file), join(root, 'public/skills', file));
  }
  console.log(check ? 'Backend/public agent documents agree.' : 'Synchronized agent documents, references and skill archive.');
} finally { await rm(work, { recursive: true, force: true }); }
