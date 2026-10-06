<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## HTTP command execution

`POST /containers/exec` requires an owned, running `id` and its exact `createdAt`
in the query. Cookie mutations require a trusted Origin; API keys work without
Origin. The JSON body accepts only `command` and optional `timeoutMs`.
A command must be nonblank, contain no NUL, and fit in 16 KiB of UTF-8; the whole
request is limited to 32 KiB. No user, image, resource, or lease overrides are accepted.

The timeout defaults to 30 seconds, accepts integers from 1 to 60,000 ms, includes
process startup, and never exceeds the container's hard deadline. The command
gets closed stdin and separate UTF-8 stdout/stderr, with a combined limit of 1 MiB.
Normal completion returns an integer `exitCode`, including nonzero command exits.
Timeout and excess output terminate the process and return partial output with
`exitCode: null` and `timedOut: true` or `outputTruncated: true`, respectively.
Both flags are false on normal completion. Output ordering between streams is
not preserved; invalid UTF-8 is replaced when decoded.

Four HTTP commands can run concurrently per container, separately from terminal
connections. Starting a command counts as idle activity without extending the
hard deadline or consuming a start. Stopping/replacing a machine revokes commands.
A disconnect requests cancellation when observable; the timeout still applies
when the platform does not propagate a disconnect. Background jobs and reconnect
are not supported. Results are not retained. An HTTP failure can hide a completed
command: do not blindly retry commands with side effects. SSH remains available
for longer-running and interactive workflows.
