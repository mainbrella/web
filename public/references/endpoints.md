<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Endpoints

| Method and path | Result |
| --- | --- |
| `GET /containers` | 200: current containers, effective plan, limits, and usage. Does not renew idle time. |
| `POST /containers` | 200: reserves a start and boots the selected machine size (default lite) using the default Node image or optional JSON `{catalogId, size}` / `{imageId, size}` selection; returns status after readiness. 402 without paid access; 409 if the concurrency cap is occupied; optional `Idempotency-Key` resolves retries to one reservation for 24 hours and adds `creation` identity/status; 429 if monthly starts are exhausted. |
| `DELETE /containers?id=<id>&createdAt=<generation>` | 200: stops the selected container and returns status. Generation is optional but recommended to reject stale actions. An explicit ID is required when multiple containers exist. Does not refund starts. |
| `POST /containers/exec?id=small&createdAt=<ISO generation>` with `{"command":"echo hello","timeoutMs":30000}` | 200: `{stdout, stderr, exitCode, timedOut, outputTruncated}`. ID and exact generation are required. Runs a foreground `/bin/sh -lc` command without SSH or a PTY. |
| `GET /containers/files?id=<id>&createdAt=<generation>&path=<absolute-path>` | 200: raw `application/octet-stream` bytes for a regular file, up to 1 MiB. ID, exact generation, and URL-encoded path are required. |
| `PUT /containers/files?id=<id>&createdAt=<generation>&path=<absolute-path>` with a raw byte body | 200: `{path, size}` after writing up to 1 MiB. An empty body creates an empty file. Requires an existing parent directory. |
| `GET /containers/files/list?id=<id>&createdAt=<generation>&path=<directory>&limit=100&offset=0` | 200: one sorted directory page, `{path, entries, nextOffset}`. |
| `GET /containers/files/stat?id=<id>&createdAt=<generation>&path=<path>` | 200: entry metadata; optional `followSymlinks=true` reads the target. |
| `POST /containers/files/mkdir?id=<id>&createdAt=<generation>` with `{path, recursive?, mode?}` | 200: creates a directory; missing parents require `recursive: true`. |
| `DELETE /containers/files/remove?id=<id>&createdAt=<generation>&path=<path>` | 200: removes a file, symlink or empty directory; nonempty directories require `recursive=true`. |
| `POST /containers/files/move?id=<id>&createdAt=<generation>` with `{path, destination}` | 200: moves to an unused destination without replacement or nesting. |
| `PATCH /containers/files/chmod?id=<id>&createdAt=<generation>&path=<path>` with `{mode: "0644"}` | 200: sets permission bits; leaf symlinks are rejected. |
| `GET /containers/events?id=<id>&createdAt=<generation>` | 200: bounded lifecycle events, stable IDs and cursor pagination. |
| `GET /containers/metrics?id=<id>&createdAt=<generation>` | 200: provider workload buckets or unobserved; disabled pending operator qualification. |
| `/containers/webhook?id=<id>&createdAt=<generation>` | GET reads configuration; PUT configures/rotates and returns a signing secret once; DELETE removes future deliveries. Disabled pending operator configuration. |
| `POST /containers/ssh` with `{"id":"small","createdAt":"<ISO generation>"}` | 200: `{command, expiresAt, hostname}` for the selected running container. Generation is optional. `expiresAt` is Unix milliseconds. Access lasts at most 15 minutes or until hard container expiry, whichever comes first. |

Lifecycle response example (UTC timestamps and usage month):

```json
{
  "plan": "builder",
  "active": true,
  "containers": [{
    "id": "small",
    "name": "Small container",
    "size": "lite",
    "computeUnits": 1,
    "instance": "lite",
    "status": "running",
    "createdAt": "2026-10-05T12:00:00.000Z",
    "expiresAt": "2026-10-05T13:00:00.000Z"
  }],
  "limits": {
    "maxComputeUnitHours": 250,
    "maxConcurrentComputeUnits": 28,
    "maxContainers": 5,
    "maxStartsPerMonth": 1000,
    "maxSessionMs": 3600000,
    "idleTimeoutMs": 600000
  },
  "usage": {"month": "2026-10", "starts": 1, "computeUnitHours": 0, "reservedComputeUnitHours": 1, "availableComputeUnitHours": 249, "concurrentComputeUnits": 1}
}
```

The response also includes a `sizes` catalog (omitted above for brevity). `containers` is empty when stopped. During a concurrent launch, a reserved slot
may appear with `status: "starting"`; terminal and SSH access require `running`.
Unpaid status has `plan: null`, `active: false` and zero limits. An unpaid first
start returns 402 without provisioning or consuming quota. If an existing billing
record is now unpaid, an attempted start also triggers background revocation of
that account's existing containers.

| Plan | USD/month | Concurrent containers | Starts/UTC month | Hard limit | Idle timeout |
| --- | ---: | ---: | ---: | --- | --- |
| Builder | $5 | 5 | 1,000 | 1 hour | 10 minutes |
| Pro | $180 | 100 | 10,000 | 24 hours | 30 minutes |
| Scale | $999 | 500 | 100,000 | 72 hours | 60 minutes |

All plans offer five sizes with bash, tmux and outbound internet. `POST /containers` accepts `size`: `lite` (default), `small`, `medium`, `large`, or `xl`. Size is included in the idempotency fingerprint. The default image includes Node 24; other runtimes depend on the selected image. All include SSH and browser terminals. A container permits four concurrent
terminal connections (browser/SSH combined). An account permits ten live SSH
access tokens, each lasting at most 15 minutes or the machine deadline. Snapshots,
resume after stop, custom resources, SDKs, teams, advanced logs/audits and priority
capacity are unavailable. Monthly fees are fixed; compute usage is not billed.
The filesystem is lost when a container stops.

Ownership and resources come from the authenticated account and server policy.
Request bodies and client headers cannot override the owner, plan, registry image, raw resource configuration,
slots or deadlines. The named `size` field selects a server-defined size. IDs returned by status select only the authenticated account's
slots. Arbitrary `/containers/<id>` routes are rejected. All sessions of the same
account share the same concurrency and UTC monthly quota.

The account serializes reservations before booting, so concurrent launches never
exceed its cap. Readiness can proceed in parallel. Failed starts still consume a
reservation; stopping early does not refund usage. Quota persists across stops,
restarts, upgrades, downgrades, cancellation and resubscription, and resets at the
next UTC month. At capacity, additional POSTs return 409 without spending usage.

A successful payment for the current recognized plan period is required. Unapproved Stripe trials,
failed payments, expired periods, paused/canceled subscriptions and stale database
plan fields grant no access. Stripe outages return 503 instead of guessing a plan.
DELETE cleanup remains available during billing outages. Hard deadlines are fixed
at creation and capped by the original paid period; upgrades and renewals never
lengthen existing sessions. Start a new container after that deadline.
Downgrades/cancellation take effect at the end of the paid period. On an effective
downgrade, excess machines stop (oldest unexpired machines within the cap remain) and deadlines
are clamped; loss of paid access stops all machines. Polling/token issuance do not
renew idle time; terminal activity renews only the idle deadline.
