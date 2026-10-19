const web = (worker, config, checks, publish, assets) => ({
  directory: '.', worker, config, checks, preflight: [], publish, assets,
});

// Each ordinary release has one worker. Coordinated backend operations have a
// separate workflow; security provisioning and SDK/image publishing stay explicit.
export const targets = {
  site: web('mainbrella-web', 'wrangler.jsonc', ['docs:check', 'test', 'build:site'], 'deploy:site', './dist'),
  builder: web('mainbrella-builder', 'wrangler.builder.jsonc', ['test', 'build:builder'], 'deploy:builder', './dist-builder'),
  redirect: web('mainbrella-www-redirect', 'wrangler.redirect.jsonc', ['test'], 'deploy:redirect'),

};

export function targetFor(name) {
  if (!Object.hasOwn(targets, name)) throw new Error(`Choose one deploy target: ${Object.keys(targets).join(', ')}.`);
  return targets[name];
}
