<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Errors and retry behavior

Errors are JSON `{ "error": "code" }`. Handle HTTP status as well as the code.

| Status | Code | Action |
| --- | --- | --- |
| 400 | `invalid_container_id` / `container_id_required` | Select an ID returned by GET; supply it when multiple containers exist. |
| 400 | `invalid_generation` / `invalid_file_path` | Send the exact returned creation timestamp and a valid absolute file path. |
| 401 | `not_authenticated` | API key or session missing, malformed, expired, or revoked. Provision a valid credential. |
| 402 | `subscription_required` | No paid container access. Use the web billing controls to add prepaid funds or resolve legacy payment; do not retry creation. |
| 403 | `origin_required` / `origin_not_allowed` | Cookie mutations need a trusted Origin; Bearer requests may omit it. Supplied Origins must be trusted. |
| 404 | `not_found` | Use the exact documented route; no arbitrary container IDs. |
| 413 | `request_too_large` | HTTP execution body exceeds 32 KiB. |
| 413 | `file_too_large` | File transfer exceeds 1 MiB. Use authorized SSH for larger files. |
| 404 | `file_not_found` | Check the file path; for writes, create the parent directory first. |
| 409 | `not_regular_file` | Use a regular file; writes also reject existing symlinks. |
| 403 | `file_access_denied` | Check guest filesystem permissions and available disk space. |
| 405 | `method_not_allowed` | Use the documented HTTP method. |
| 409 | `container_limit_exceeded` | The plan's concurrency cap is occupied. GET status and reuse it, or stop it only if the task authorizes replacement. |
| 404 | `image_not_found` | Choose an advertised catalog ID or an owned custom image. |
| 409 | `image_not_ready` / `image_not_available` | Wait for custom-image readiness or choose a currently published catalog image. |
| 409 | `container_not_running` | Execution, files, and SSH need the exact live generation; GET status before deciding whether to start. |
| 429 | `container_quota_exceeded` | The plan's starts are exhausted this UTC month. Wait for next month; do not retry or create another account to evade the limit. |
| 429 | `terminal_limit` | Four terminal connections are attached to this container. Close or reuse an existing connection. |
| 429 | `execution_limit` | Four HTTP command/file operations are already active on this container. Wait for completion. |
| 429 | `ssh_token_limit` | Ten live SSH access tokens for this account. Reuse existing access or wait for expiration. |
| 503 | `billing_unavailable` / `containers_unavailable` / `ssh_unavailable` / `execution_unavailable` / `files_unavailable` | Service unavailable. Reconcile with GET before any further launch; read a file to reconcile an uncertain write. |

Use `Idempotency-Key` on `POST /containers` for safe creation retries. Keys accept
1–128 letters, digits, underscores or hyphens, are scoped to the authenticated
account, and are retained for 24 hours from reservation. Repeat the same key and
image selection after a timeout or 503; this resolves to the original operation
without another charge or boot. A keyed 200 response adds
`creation: {id, containerId, createdAt, status}`. `id` identifies the operation;
`status` is `starting` or `running`. Wait for `running` before using the returned
container ID and exact generation for execution or cleanup. Other entries in
`containers` may belong to concurrent work.

A changed image selection returns 409 `idempotency_key_conflict`. If the original
reservation failed, stopped, expired, or its slot was reused, retries return 409
`creation_no_longer_running` with `creation: {id, containerId, status: "stopped"}`;
they never launch a replacement. Failed starts still consume quota. After 24 hours,
a key may create a new operation; use a new key for each intentional launch and
never retry an old operation beyond that window. Billing and authorization checks
still apply. Without a key, each POST may reserve a new start: reconcile with GET
after an ambiguous result and do not blindly retry. Allow at least 60 seconds for
the readiness check.

SSH tokens stop working when
the container stops or is recreated; do not print the returned token-bearing
command in shared logs. Use HTTP execution for bounded foreground jobs. Use the returned SSH command
with trusted `ssh` and `cloudflared` tools for interactive or longer jobs.
