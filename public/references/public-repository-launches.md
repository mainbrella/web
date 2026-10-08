<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Public repository launches

The browser entry point is `https://mainbrella.com/run/?repo=OWNER/REPO&ref=main`.
Opening a share link prepares a launch; **Run repository** creates a private launch
for the signed-in recipient using their paid or coupon-trial allowance. The default
result is a shell in `/workspace/repo` on a Small machine. Each recipient gets a
separate container. GitHub login is unnecessary for public repositories.

Optional query/body fields are `ref`, `catalogId` (`node`, `python`, `rust`, `go`,
`devops`), `size`, `cwd` (relative to the checkout), `setupCommand`, `startCommand`,
and `port` (1024–65535). Start command and port must be supplied together. Runtime
suggestions use manifests in the working directory; ambiguous projects default
to Node and allow an override. Commands from share links are visible before Run.

Catalog selection does not guarantee native build prerequisites. Inspect dependency
install/postinstall scripts and the repository Dockerfile, then check tools in the
actual container before installing dependencies. For example, `node-pty` may fall
back to `node-gyp` when prebuilt binaries are unavailable, requiring `python3`,
`make`, and `g++`. Include conditional installation of missing system packages in
`setupCommand` using the guest OS/package manager and available privileges; on
Debian this is `apt-get update` followed by
`apt-get install -y --no-install-recommends python3 make g++`. Do not skip required
lifecycle scripts or regenerate the lockfile to bypass this failure. Repair failed
installs in the retained container, preserving its checkout and completed work.
Repository Dockerfiles are evidence for prerequisites, not automatically compatible
custom images: this launch contract accepts `catalogId`, not `imageId`, and custom
images require one stage starting with `FROM mainbrella:base`.

Authenticated endpoints accept session cookies or existing session/API Bearer
credentials. Cookie mutations require a trusted Origin:

- `GET /repo-launches/resolve?repo=OWNER/REPO&ref=main&cwd=.` validates the public
  repository, resolves an immutable commit, and suggests a runtime. No allocation.
- `POST /repo-launches` with the settings JSON and a stable `Idempotency-Key`
  validates paid/trial access and resolves the commit before storing the launch.
  It returns a launch with `id`, `phase`, `options`, `repository`, `container`,
  `executions`, `createdAt`, `shellReadyAt`, `previewReadyAt`, and `error`.
  Repeating identical settings/key returns the original launch; mismatches return
  409. Creating this record does not allocate until advance.
- `GET /repo-launches/{id}` reads owner-scoped progress. No allocation or replay.
- `POST /repo-launches/{id}/advance` performs or reconciles one workflow step.
  Repeat while phases are `allocating`, `cloning`, `setup`, or `starting`. A lease
  and stable allocation/execution keys prevent duplicate side effects. Retained
  execution IDs are inspected before moving on. End phases are `ready`, `failed`,
  and `stopped`. An expired or reused container slot is never resumed.

The browser stores private run/request identities in the URL fragment, preserves
settings through sign-in with `returnTo`, and copies share links without those
identities. An uncertain initial submission asks for Resume with the same key.
GitHub errors occur before allocation; rate-limited lookups return 429.

Clone/setup/startup checks use retained managed executions. The browser terminal
attaches to the `main` tmux session created at the checkout root. The server runs
in `mainbrella-preview`, with output at `/workspace/.mainbrella-preview.log`, under
normal container idle and hard deadlines. Readiness requires a successful HTTP
response at `/` on the chosen port. The server should listen on `0.0.0.0`. Setup
and startup failures leave the terminal available for manual repair; failed or
uncertain commands are never silently rerun after history expires.

Use the existing execution API to read output and the previews API to issue a
link after readiness. Preview URLs are returned once and never stored in launch
records. The page renews by reconciling/revoking existing grants on that port and
issuing a fresh link. Links last up to 15 minutes, do not extend the container
lease, and give anyone with the URL access. Cookie-based apps are unsupported.

Apply `migrations/013_repo_launches.sql` before deploying this API. Production
rollout requires the frontend, API and new SDK CLI release together; source
availability does not imply the currently published npm package contains `repo`.
