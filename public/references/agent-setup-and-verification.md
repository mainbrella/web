<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Agent setup and verification

The [published skill](https://mainbrella.com/SKILL.md) guides project detection,
integration, and troubleshooting. Provision `MAINBRELLA_API_KEY` through your
existing secret manager or environment loader; never put it into chat or commit it.
No Mainbrella SDK is published yet. Use native HTTP requests for lifecycle,
command execution, and file transfer; local SSH tools are optional for interactive access.
Local dependency-free SDK packages are available in this backend repository at
`sdk/javascript` and `sdk/python`; their READMEs describe local installation. Do
not assume these names can be installed from public npm/PyPI registries.

Download and inspect the dependency-free Node 22+ tools:

```sh
curl --fail --silent --show-error https://mainbrella.com/mainbrella-doctor.mjs -o mainbrella-doctor.mjs
curl --fail --silent --show-error https://mainbrella.com/mainbrella-verify.mjs -o mainbrella-verify.mjs
node mainbrella-doctor.mjs
# This creates a container and consumes one start. Run after the doctor passes.
node mainbrella-verify.mjs
```

Keep both scripts in the same directory. The doctor performs only GET requests,
checks access, quotas, image availability, HTTP execution/file routes, Node version, and project markers, and
never prints credentials. Both commands print JSON and exit 0 for a pass or 1
for a failure. `MAINBRELLA_API_URL` can select another HTTPS API origin, or HTTP
localhost for development. `MAINBRELLA_CATALOG_ID` selects an advertised image for
verification; it defaults to `node`.

Verification runs `echo "hello from mainbrella"`, checks stdout and exit code 0,
writes and reads a six-byte binary probe under `/tmp`, and compares every byte.
It deletes the newly created generation in `finally`. Pass requires
`ok: true`, `files: "verified"`, and `cleanup: "completed"`. It preserves pre-existing containers.
It uses a unique idempotency key and the returned `creation` identity, so concurrent
launches cannot confuse ownership. It retries the same operation up to three times
on a lost response or a `starting` result. Unresolved startup produces
`creation_ambiguous` and `cleanup: "reconcile_manually"`, with `creationKey` for
recovery: repeat the same POST body and key within 24 hours. It never deletes a
machine by guesswork. Cleanup failures include the created ID and generation.
