import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { release } from './release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = (command, args, options) => execFileSync(command, args, { stdio: 'inherit', ...options });

export function parseArguments(args) {
  if (!args.length) return { mode: 'publish' };
  if (args.length === 1 && args[0] === '--check') return { mode: 'check' };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { mode: 'help' };
  throw new Error('Usage: npm run deploy [-- --check]. Deploys the builder, then the site, directly from this machine.');
}

export function deployWeb({ publish = true, directory = root, env = process.env, run = execute } = {}) {
  const builder = release('builder', { publish, local: publish, directory, env, run });
  const site = release('site', { publish, local: publish, directory, env, run });
  return { builder, site };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { mode } = parseArguments(process.argv.slice(2));
    if (mode === 'help') {
      console.log('npm run deploy                 Build and deploy the builder, then the site, using local Wrangler login.');
      console.log('npm run deploy -- --check      Check and bundle both deployments without publishing.');
    } else deployWeb({ publish: mode === 'publish' });
  } catch (error) {
    console.error(error.status ? 'Web deployment failed. Review the preceding output and release records before retrying.' : error.message);
    process.exitCode = 1;
  }
}
