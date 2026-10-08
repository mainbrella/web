<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Compiled application deployment

An advertised image can run a compiled binary even when it lacks the source
language's compiler. This is an optional fallback when the requested runtime
image is unavailable. Confirm the guest OS and architecture (for example with
`uname -s` and `uname -m`) and any shared-library requirements. Do not infer the
guest architecture from the local computer or assume every binary is portable.

Build locally using the project's existing toolchain and dependency conventions,
targeting the guest platform. The local Go/SQLite example uses a pure-Go SQLite
driver and `GOOS=linux GOARCH=amd64 CGO_ENABLED=0`; a CGO-based driver may need a
different build environment and matching runtime libraries. Local compilation
also avoids putting a build workload into a 256 MiB Lite guest.

Upload through generation-qualified `PUT /containers/files` in chunks of at most
1 MiB, concatenate in order, and verify the complete binary's SHA-256 against the
local artifact before execution. File uploads create mode 0600; set executable
permissions explicitly. Reconcile uncertain writes before retrying. Start the
server with an execution mode appropriate to its lifetime: managed jobs are
limited to 15 minutes; the detached `setsid nohup` pattern in the static-site
recipe remains bounded by the container lease. Check HTTP readiness before
issuing a preview, and save generation-qualified cleanup instructions.
