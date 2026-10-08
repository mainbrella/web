<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Agent setup and verification

The [published skill](https://mainbrella.com/SKILL.md) guides project detection,
integration, and troubleshooting. Provision `MAINBRELLA_API_KEY` through your
existing secret manager or environment loader; never put it into chat or commit it.
The dependency-free SDKs are published as `@mainbrella/sdk` 0.1.0 on npm
and `mainbrella` 0.1.0 on PyPI. See the
[JavaScript](https://mainbrella.com/sdk/javascript.md) and
[Python](https://mainbrella.com/sdk/python.md) references for installation and APIs.
Native HTTP remains sufficient for lifecycle, execution and file transfer;
local SSH tools are optional for interactive access.

Download and inspect the dependency-free Node 22+ tools:

```sh
curl --fail --silent --show-error https://mainbrella.com/mainbrella-doctor.mjs -o mainbrella-doctor.mjs
curl --fail --silent --show-error https://mainbrella.com/mainbrella-verify.mjs -o mainbrella-verify.mjs
node mainbrella-doctor.mjs
# This creates a container and consumes one start. Run after the doctor passes.
node mainbrella-verify.mjs
```

For a project with an existing ignored `.env`, use Node’s built-in loader:
`node --env-file=.env mainbrella-doctor.mjs` (likewise for verification/deployment).
Never copy the key into the guest or expose it through a Vite `VITE_*` variable
or client bundle. Keep both scripts in the same directory. The doctor checks
readiness for the full verification suite, including managed execution, SSE,
reconnect and cancellation. It performs only GET requests,
checks access, quotas, image availability, HTTP execution/file routes, Node version, and project markers, and
never prints credentials. Both commands print JSON and exit 0 for a pass or 1
for a failure. `MAINBRELLA_API_URL` can select another HTTPS API origin, or HTTP
localhost for development. `MAINBRELLA_CATALOG_ID` selects an advertised image for
verification; it defaults to `node`.

When the user supplies a credential variable and origin explicitly, keep that
pair throughout doctor, verification, and deployment. For a local key stored as
`MAINBRELLA_LOCAL_API_KEY`, load the existing `.env` and map that value to
`MAINBRELLA_API_KEY` only in the tool process, with
`MAINBRELLA_API_URL=http://localhost:8787`. The tools still read their standard
variable names. Do not rewrite `.env`, request a second key, or fall back to the
production origin with the local credential.

Verification runs `echo "hello from mainbrella"`, checks stdout and exit code 0,
writes and reads a six-byte binary probe under `/tmp`, and compares every byte.
It also starts a managed job, consumes SSE output (resuming the last cursor if
disconnected), checks the retained result, then starts `sleep 30`, cancels it
and polls for `canceled`. Foreground, background, streaming, reconnect,
cancellation and binary read/write capabilities are required. All checks share
one new container/start. It deletes that generation in `finally`. Pass requires
`ok: true`, `stdout: "hello from mainbrella"`, `exitCode: 0`, `files: "verified"`,
`managed: "verified"`, `cancellation: "verified"`, and `cleanup: "completed"`.
It preserves pre-existing containers. The static deployment helper below checks
only its own required capabilities; a separate full verification is not a
prerequisite for every deployment and consumes an additional start.
It uses a unique idempotency key and the returned `creation` identity, so concurrent
launches cannot confuse ownership. It retries the same operation up to three times
on a lost response or a `starting` result. Unresolved startup produces
`creation_ambiguous` and `cleanup: "reconcile_manually"`, with `creationKey` for
recovery: repeat the same POST body and key within 24 hours. It never deletes a
machine by guesswork. Cleanup failures include the created ID and generation.

Budget verification and deployment separately. Setup verification followed by a
two-container app consumes three starts: the verifier cleans up its own generation
in `finally`, while a successful deployment leaves its two app generations running
for use. Save identities and provide an explicit cleanup command; report the app
leases and preview expiration separately from the verifier's cleanup result.
