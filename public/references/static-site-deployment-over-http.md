<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Static-site deployment over HTTP

This produces a **temporary preview**, not persistent hosting. The preview expires
no later than the container's hard lease; inactivity can stop the container sooner.
Ordinary stop discards the upload. Report the returned preview `expiresAt` beside
the URL, rather than calculating expiration from the requested TTL. Container IDs
are opaque: an ID such as `small` does not establish the requested machine size.

The [dependency-free Node 22+ helper](https://mainbrella.com/mainbrella-deploy-static.mjs)
is also included as `scripts/mainbrella-deploy-static.mjs` in the skill archive.
It uses native HTTP, a local `tar` executable, and a catalog Node guest with
`node`, `tar`, `setsid`, and `nohup`. It checks guest utilities before uploading;
these are prerequisites of this recipe, not a guarantee for every catalog image.
It does not require SSH, an SDK, `curl`, `ps`, or `sha256sum` in the guest.
Build locally using the existing package manager; the Lite guest only serves
public static output. This helper does not run framework servers or provide SPA
history fallback. Include only files intended for public access in `dist/`.

```sh
# Download and inspect the helper before running it.
curl --fail --silent --show-error https://mainbrella.com/mainbrella-deploy-static.mjs -o mainbrella-deploy-static.mjs
# Preserve the project's package manager and build command.
npm run build
# Keep .mainbrella/ ignored and private. New directories use 0700, state uses 0600.
# Remove --env-file=.env if credentials already come from the environment.
node --env-file=.env mainbrella-deploy-static.mjs \
  --dist dist --state .mainbrella/deployment.json \
  --check /download/ --check /privacy/ --check /terms/ \
  --check /dryerasiac.css --check /images/logo.png
# Add --check /assets/<actual-built-file>.js for the JS emitted by this build.
```

Check paths are examples: select paths that exist in the actual build. Root is
always checked; `--check` adds pages or assets and compares exact bytes with the
local files. Directory paths must end in `/`; their bare path must return a 308
redirect to the directory. A generated missing path must return 404. This checks
HTTP serving through the preview gateway; it does not prove browser rendering
or JavaScript behavior. Perform a browser check when that matters to the task.

The helper follows this workflow:

1. Validate local static files (reject symlinks), create a gzip tar archive, and
   check foreground execution, binary files, previews, Node image and allowances.
2. Save a UUID creation key and exact `{catalogId:"node",size:"lite"}` selection
   before POST. Retry the same key/body at most three times for transport/5xx or
   `starting` responses. Known 4xx errors stop immediately. This is one logical
   start; unresolved or failed starts may still consume allowance.
3. Save returned ID, exact `createdAt` generation, hard expiration and upload
   directory. Upload sequential chunks of at most `1024 * 1024` bytes through
   `PUT /containers/files`, with generation-qualified, encoded query values.
   For an uncertain PUT, read that file and compare SHA-256 before continuing.
4. Concatenate zero-padded chunks, compare the full archive's SHA-256 using Node
   crypto, and extract only after the hash matches. A roughly 13 MB static build
   can use this recipe without exceeding the per-file limit; compression may
   reduce the number of chunks. Chunking does not remove disk, memory, execution
   timeout or lease limits. The helper buffers the archive in memory and is meant
   for modest artifacts, not unbounded bulk transfers.
5. Upload the Node static server, then start it on `0.0.0.0:3000` with explicit
   detachment and redirected descriptors:

   ```sh
   setsid nohup node <upload-dir>/server.cjs <upload-dir>/site 3000 \
     > <upload-dir>/server.log 2>&1 < /dev/null &
   ```

   Wait one second, then probe `http://127.0.0.1:3000/` using native Node `fetch`,
   up to ten attempts with one-second request limits and 500 ms intervals.
   A successful shell exit alone does not prove server readiness. On failure,
   preserve the command result and inspect the final 8 KiB of `server.log` through
   Node before cleanup. Do not assume `ps` is installed. This startup recipe
   succeeded in a reported deployment; the earlier failure discarded diagnostics,
   so missing `setsid` or a startup race is not an established root cause.
6. Persist `previewPending:true`, request `{port:3000,ttlSeconds:900}`, save the
   one-time URL/metadata, then verify root, selected pages/assets, redirects and
   404 through that URL. The final JSON reports success, preview ID, actual ISO
   expiration, exact container generation and state path. It keeps the bearer
   URL in the private state file rather than stdout. Read it privately and share
   only with the requested recipient, alongside expiration and the idle limit.

The helper leaves success running and preserves failure for inspection. A failed
run can continue consuming compute until explicitly stopped or expired. It
refuses to overwrite existing state; it does not automatically resume commands,
launch a replacement, retry preview issuance, or clean up evidence.

State includes `apiOrigin`, `creationKey`, `creationBody`, `container:{id,createdAt}`,
`containerExpiresAt`, `step`, archive hash/chunk count, `uploadChunk`,
`lastCommand:{command,pending}` or `{command,result}`, bounded server-log result,
`apiError:{status,code,previewId}`, `previewPending`, preview metadata/URL,
`verifiedPaths` and cleanup status. Writes are atomic, mode 0600 and fsynced before
further mutations. Command diagnostics retain stdout, stderr, `exitCode`,
`timedOut` and `outputTruncated` privately; they must not enter shared logs.
HTTP errors expose status, allowlisted API code and validated reconciliation ID,
not raw server bodies. Unknown codes become `request_failed`.

Recovery before another start:

- If creation is unresolved, repeat the exact saved body/key within 24 hours.
  Resolve ownership from `creation.containerId` and `creation.createdAt`, not
  another task's container. Save the matching running identity before cleanup.
- If a command is still pending after a transport failure, inspect its effects
  and log on the exact generation before deciding whether to run it again.
- If preview issuance is pending, GET the generation's preview metadata and revoke
  its grants before another issuance. This helper owns a dedicated generation;
  do not revoke unrelated grants on a shared machine. A known
  `preview_reconciliation_required` supplies the ID for generation-qualified
  revocation. Do not retry POST blindly; URLs are not recoverable from listing.
- Preserve state and logs before stopping. Explicit cleanup removes only the
  saved generation and confirms its absence in the returned status:

  ```sh
  node --env-file=.env mainbrella-deploy-static.mjs \
    --cleanup --state .mainbrella/deployment.json
  ```

  If cleanup is uncertain, retain state and reconcile with GET `/containers`;
  never target a replacement in the same slot. Keep resolved state as diagnostic
  evidence; use a new state path for a deliberately new deployment.
