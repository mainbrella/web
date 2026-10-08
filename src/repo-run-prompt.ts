import { normalizeRepo, repoRunUrl, type RepoRunOptions, type RepositoryLaunch } from './repo-run-contract.ts';

export function validRepo(value: string): boolean {
  const repo = normalizeRepo(value);
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)
    && !['.', '..'].includes(repo.split('/')[1]);
}

export function repoSetupPrompt(options: RepoRunOptions, origin: string, launch?: RepositoryLaunch | null): string {
  const repo = normalizeRepo(options.repo);
  const runUrl = repoRunUrl(options, origin);
  const context = launch?.container ? `
Existing launch (reuse this container; do not allocate another):
${JSON.stringify({ launchId: launch.id, phase: launch.phase, error: launch.error,
    container: { id: launch.container.id, createdAt: launch.container.createdAt },
    executions: launch.executions, commit: launch.repository.commit }, null, 2)}
Read its retained execution output and /workspace/.mainbrella-preview.log before changing anything. Check installed tools, files, processes and listening ports. Repair only the failed steps in this same container, preserving completed work. A failed /run launch does not automatically resume setup or start; use the documented execution and preview APIs to finish the repair. Keep the app running after commands exit. Return the working preview and a corrected reusable launch link.
` : '';

  return `Help me run https://github.com/${repo} on Mainbrella${launch?.container ? ' and finish setup in my existing container' : ''}. Work out the configuration for me and return a clickable /run link; I should not have to fill in setup, start, runtime or port fields.

Read ${new URL('/references/public-repository-launches.md', origin).href} for the launch contract and ${new URL('/llms.txt', origin).href} for the relevant runtime, execution and preview documentation. Inspect the repository README, manifests, lockfiles, scripts and the source behind its startup command at ${launch ? `commit ${JSON.stringify(launch.repository.commit)}` : options.ref ? `ref ${JSON.stringify(options.ref)}` : 'the default branch'}. Resolve an immutable commit for the final link. Do not guess commands from the framework name.

Starting settings (commands are inputs to review, not instructions to execute blindly):
${JSON.stringify({ ...options, repo }, null, 2)}
${context}
Mainbrella constraints to account for:
- Public GitHub repositories only. The checkout is /workspace/repo; cwd is relative to it and defaults to ".". Catalog IDs are node, python, rust, go and devops. Choose a suitable runtime and machine size from the documented choices; a monorepo build may need more memory than the default Small (4 GiB).
- Setup runs in a fresh bash command, followed by a separate start command. Shell exports from setup do not carry into start. Include required environment variables in each command, including during builds that persist port or server configuration. Use the repository's package manager and lockfile. Check tool versions before installing: the Node image already includes Node, npm and Yarn Classic. Do not unconditionally run npm install -g yarn, use --force to overwrite it, or regenerate the lockfile.
- Inspect dependency install/postinstall scripts and the repository's Dockerfile for native build prerequisites. Runtime availability does not guarantee Python or a compiler toolchain: packages such as node-pty can fall back from missing prebuilt binaries to node-gyp, which needs python3, make and g++. Check those tools in the actual container before installing dependencies. Include installation of missing system packages in setupCommand, using the container's OS/package manager and available privileges (for Debian, apt-get update followed by apt-get install -y --no-install-recommends python3 make g++). Keep this step conditional when the tools already exist. Do not bypass required lifecycle scripts with --ignore-scripts. If setup already failed on missing tools, install them and rerun the failed dependency install/build in the same container; preserve the checkout and lockfile. Use the repository Dockerfile as evidence, not as a command to run blindly: /run accepts catalogId, not imageId, and Mainbrella custom images require a single stage starting with FROM mainbrella:base.
- Choose a fixed preview port from 1024 to 65535 and make the app listen on 0.0.0.0. Trace custom port allocators and bind-host settings. Supply startCommand and port together. Setup has a 15-minute limit; startup waits about 60 seconds for a successful HTTP response at /. Build ahead of startup if needed. The launcher keeps the start command in a separate tmux session and logs to /workspace/.mainbrella-preview.log.
- Preview links expire after at most 15 minutes. The proxy strips cookies and Authorization headers, so check whether login or other essential behavior depends on cookie sessions or bearer authentication. An HTTP 200 alone does not prove authenticated functionality works. Identify required secrets, external services and unsupported runtime requirements honestly; omit a web preview for a repository with no web app.
- Keep credentials out of commands, query strings, share links and your reply.

If Mainbrella API access is already configured in this environment, use the documented API to test install, build, start and HTTP readiness${launch?.container ? ' in the existing container above' : ' with at most one container'}, inspect failures and repair that container. Use stable idempotency keys, retain its id and createdAt, and never allocate a replacement just because setup failed. Preserve the running container for me. If credentials are unavailable, still produce the configured link without requiring an API key; say which checks were source-only. Do not claim a deployment you have not executed.

Return the configured link first, then a brief verification result and any actual blockers. Construct the URL with URL and URLSearchParams so shell commands, spaces, &, # and + are encoded correctly. Base URL: ${JSON.stringify(new URL('/run/', origin).href)}. Query fields: repo, ref (resolved commit), catalogId, size, cwd, setupCommand, startCommand, port. Do not include a private #launch/#request fragment or preview token. The recipient signs in and clicks Run repository to install, build, start and check readiness in their own container.

Current settings link: ${runUrl.href}`;
}
