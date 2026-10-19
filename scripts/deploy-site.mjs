import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkBuild } from './check-build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const execute = (command, args, options) => execFileSync(command, args, { stdio: 'inherit', ...options });

export async function deploySite({ directory = root, env = process.env, args = [], run = execute } = {}) {
  if (args.some(arg => arg === '--assets' || arg.startsWith('--assets='))) throw new Error('The site publisher selects its verified asset snapshot.');
  const options = { cwd: directory, env };
  run('npm', ['run', 'build:site'], options);
  await mkdir(join(directory, '.wrangler'), { recursive: true });
  // The release runner keeps this snapshot until it has recorded its hash.
  // Direct npm deployments own and clean up their temporary snapshot here.
  const temporary = env.CANOPY_SITE_ASSET_SNAPSHOT ? undefined : await mkdtemp(join(directory, '.wrangler/site-assets-'));
  const snapshot = env.CANOPY_SITE_ASSET_SNAPSHOT || join(temporary, 'assets');
  try {
    await cp(join(directory, 'dist'), snapshot, { recursive: true, errorOnExist: true, force: false });
    await checkBuild('site', snapshot);
    const require = createRequire(join(directory, 'package.json'));
    const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
    run(process.execPath, [wrangler, 'deploy', ...args, '--assets', snapshot], options);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await deploySite({ args: process.argv.slice(2) }); }
  catch (error) {
    console.error(error.status ? 'Site deployment failed. Review the preceding output before retrying.' : error.message);
    process.exitCode = 1;
  }
}
