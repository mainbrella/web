import { normalizeRepo, type RepoRunOptions, type RepositoryLaunch } from './repo-run-contract.ts';

export function validRepo(value: string): boolean {
  const repo = normalizeRepo(value);
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)
    && !['.', '..'].includes(repo.split('/')[1]);
}

export function repoSetupPrompt(options: RepoRunOptions, origin: string, launch?: RepositoryLaunch | null): string {
  const repo = normalizeRepo(options.repo);
  const context = launch?.container ? `
Existing launch (reuse this container; do not allocate another):
${JSON.stringify({ launchId: launch.id, phase: launch.phase, error: launch.error,
    container: { id: launch.container.id, createdAt: launch.container.createdAt },
    executions: launch.executions, commit: launch.repository.commit }, null, 2)}
Read its retained execution output and /workspace/.mainbrella-preview.log before changing anything. Check installed tools, files, processes and listening ports. Repair only the failed steps in this same container, preserving completed work. A failed /run launch does not automatically resume setup or start; use the documented execution and preview APIs to finish the repair. Keep the app running after commands exit. Return the working preview and a corrected reusable JSON configuration.
` : '';

  return `Help me run https://github.com/${repo} on Mainbrella${launch?.container ? ' and finish setup in my existing container' : ''}. Work out the configuration for me and return JSON that I can paste into ${new URL('/run/', origin).href}; I should not have to fill in setup, start, runtime or port fields. Do not generate a launch URL with configuration in query parameters.

Read ${new URL('/references/public-repository-launches.md', origin).href} for the launch contract and ${new URL('/llms.txt', origin).href} for the relevant runtime, execution and preview documentation. Inspect the repository README, manifests, lockfiles, scripts and the source behind its startup command at ${launch ? `commit ${JSON.stringify(launch.repository.commit)}` : options.ref ? `ref ${JSON.stringify(options.ref)}` : 'the default branch'}. Resolve an immutable commit for the configuration. Do not guess commands from the framework name.

Starting settings (commands are inputs to review, not instructions to execute blindly):
${JSON.stringify({ ...options, repo }, null, 2)}
${context}
Mainbrella constraints to account for:
- Public GitHub repositories only. The checkout is /workspace/repo; cwd is relative to it and defaults to ".". Catalog IDs are node, python, rust, go and devops. Machine sizes are lite, small, medium, large and xl. Choose a suitable runtime and machine size; a monorepo build may need more memory than the default Small (4 GiB).
- Setup runs in a fresh bash command, followed by a separate start command. Shell exports from setup do not carry into start. Include required environment variables in each command, including during builds that persist port or server configuration. Use the repository's package manager and lockfile. Check tool versions before installing: the Node image already includes Node, npm and Yarn Classic. Do not unconditionally run npm install -g yarn, use --force to overwrite it, or regenerate the lockfile.
- Inspect dependency install/postinstall scripts and the repository's Dockerfile for native build prerequisites. Runtime availability does not guarantee Python or a compiler toolchain: packages such as node-pty can fall back from missing prebuilt binaries to node-gyp, which needs python3, make and g++. Check those tools in the actual container before installing dependencies. Include installation of missing system packages in setupCommand, using the container's OS/package manager and available privileges (for Debian, apt-get update followed by apt-get install -y --no-install-recommends python3 make g++). Keep this step conditional when the tools already exist. Do not bypass required lifecycle scripts with --ignore-scripts. If setup already failed on missing tools, install them and rerun the failed dependency install/build in the same container; preserve the checkout and lockfile. Use the repository Dockerfile as evidence, not as a command to run blindly: /run accepts catalogId, not imageId, and Mainbrella custom images require a single stage starting with FROM mainbrella:base.
- Choose a fixed preview port from 1024 to 65535 and make the app listen on 0.0.0.0. Trace custom port allocators and bind-host settings. Supply startCommand and port together. Setup has a 15-minute limit; startup waits about 60 seconds for a successful HTTP response at /. Build ahead of startup if needed. The launcher keeps the start command in a separate tmux session and logs to /workspace/.mainbrella-preview.log.
- Preview links expire after at most 15 minutes. The proxy strips cookies and Authorization headers, so check whether login or other essential behavior depends on cookie sessions or bearer authentication. An HTTP 200 alone does not prove authenticated functionality works. Identify required secrets, external services and unsupported runtime requirements honestly; omit a web preview for a repository with no web app.
- Keep credentials out of commands, query strings, share links and your reply.

${launch?.container
    ? 'If Mainbrella API access is configured, inspect failures and repair only the existing container above. Never allocate another container. Preserve the running container for me.'
    : 'Container verification is optional and uses compute. Do not create a container or execute commands through the Mainbrella API unless I explicitly ask you to verify this configuration. Available API credentials are not permission to spend compute. If I request verification, use at most one container, inspect failures and repair that same container; never allocate a replacement just because setup failed.'} Use stable idempotency keys and retain the container id and createdAt when using the API. Produce the JSON without requiring an API key; say which checks were source-only. Do not claim a deployment you have not executed.

Return exactly one launch configuration as a JSON object in a fenced json code block first, then a brief verification result and any actual blockers. Use only these fields:
- repo: ${JSON.stringify(repo)} (owner/repository, not a URL).
- ref: the resolved full immutable commit SHA.
- catalogId: one of node, python, rust, go, devops.
- size: one of lite, small, medium, large, xl.
- cwd: "." or a relative directory within the checkout, without "." or ".." path segments.
- setupCommand: the complete install/build shell command, if needed.
- startCommand: the complete server shell command, if there is a web app.
- port: the fixed preview port as a JSON integer, supplied together with startCommand.
Omit optional fields that are unnecessary; do not use null, empty commands, placeholders or abbreviated commands. Commands must be JSON strings with quotes and newlines escaped correctly, not URL-encoded. Each command must be at most 4096 characters. Do not include credentials, launch IDs or preview tokens in the configuration. I will paste your JSON or entire response into Mainbrella, review the commands, sign in and click Run repository to install, build, start and check readiness in my own container.`;
}
