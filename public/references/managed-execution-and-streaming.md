<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Managed execution and streaming

Use `POST /containers/executions?id=<id>&createdAt=<generation>` with a required
`Idempotency-Key` and `{"command":"<shell command>","timeoutMs":30000}`. It returns
202 with an execution record containing `id`, `createdAt`, timestamps, `status`,
`retainUntil` (Unix milliseconds), `cursor`, `outputBytes`, `exitCode`, `timedOut`
and `outputTruncated`. New jobs also report `stdinEnabled`, `stdinClosed`, `stdinBytes` and optional `pty` dimensions. Commands, argv, environment values and creation keys are not returned.

Matching key and all creation-option retries within the same generation return the retained
execution. Changed options return 409 `idempotency_key_conflict`. Retention lasts
one hour from admission, with 32 records per container; when full, a new job returns
429 `execution_history_limit`. After retention expires, a key can launch new work.
Preserve the key and never retry an old operation beyond its retention window.

Shell commands run `/bin/sh -lc`; alternatively pass `{"argv":["executable","literal argument"]}` without shell expansion. Supply exactly one of command/argv. Optional `cwd` is an absolute path without dot/parent segments; optional `env` has up to 64 POSIX variable names, 4096 UTF-8 bytes per value and 16 KiB of JSON. The provider inherits only PATH. Values are sent to the guest and may appear in its output; they are not a secrets vault. Jobs default to 30 seconds, allow up to 15 minutes,
and remain bounded by the hard container deadline. They share four active
operations with foreground commands and files. Active jobs renew idle activity.
Output stops at 1 MiB combined stdout/stderr or the bounded output-event count.
Client disconnect does not cancel the job. Images require GNU timeout. Cancellation and hard timeouts target the operation process group; deliberately detached processes remain bounded by the machine lease. Signal delivery is a request, not proof that every guest child has exited.

- `GET /containers/executions/<execution-id>?id=<id>&createdAt=<generation>` returns
  current state plus retained `stdout` and `stderr`.
- `DELETE` at the same URL requests cancellation and returns 202. Poll until a
  terminal state; cancellation of a completed job has no effect.
- `GET /containers/executions/<execution-id>/events?id=<id>&createdAt=<generation>&cursor=0`
  streams SSE output. stdout/stderr events carry `{type,sequence,data}` and an SSE
  `id` equal to `sequence`. Resume with the last received sequence as `cursor`.
  A cursor ahead of retained output returns 400 `invalid_cursor`.

`GET /containers/executions?id=<id>&createdAt=<generation>` lists up to 32 retained managed-job summaries for that exact generation, including terminal records. It is not a guest-wide OS process table. `commands.attach(id)` reconnects SDK controls and output to a known retained job; attaching does not start or replay it.

Start with `stdin:true` to accept raw input; otherwise stdin closes immediately. `POST /containers/executions/<execution-id>/stdin?...` sends `application/octet-stream`, up to 64 KiB per request, 1 MiB accepted per job and 256 KiB pending. Writes are ordered and respect pipe backpressure. Input is not retained or replayed. Ambiguous accepted bytes remain counted. A 30-second response bound or disconnect does not undo an accepted write; reconcile application state before sending again. `DELETE` at that stdin URL closes input after accepted writes. For a plain pipe this sends EOF; PTY closure can hang up the terminal. Closing input is not a cancellation request.

`POST /containers/executions/<execution-id>/signal?...` accepts only `{"signal":"SIGINT"}`, SIGTERM or SIGKILL. Signals are bound to retained job identity; no arbitrary guest PID is accepted. SIGKILL requests cancellation; SIGINT/SIGTERM can be handled or ignored. Inspect retained state to confirm completion. Cleanup signal/input-close operations remain available during billing outages. Sending bytes requires paid access and the exact live generation.

Start a programmatic terminal with `stdin:true` and `pty:{"cols":80,"rows":24}`. Check `execution.programmaticPty` and `ptyResize` first. Output combines stdout/stderr on stdout and follows terminal line discipline, including CRLF and possible input echo. `POST /containers/executions/<execution-id>/resize?...` accepts `{"cols":132,"rows":40}` with dimensions 1–1000 and requires the exact live paid generation. Resize does not change the original idempotency identity. Disconnect/reconnect use the same SSE cursor flow; a stream disconnect only detaches. Closing a PTY input pipe is not equivalent to a shell's Ctrl-D key. Send application-appropriate bytes or an explicit exit command, then inspect state. Arbitrary SSH/guest processes cannot be attached through this API. Filesystem watchers and guest-wide process listing remain unsupported.

SSE connections emit heartbeat comments, rotate after 30 seconds, and end with a
`status` event containing execution metadata. Reconnect after a nonterminal status;
stop after `succeeded`, `failed`, `canceled`, `timed_out`, `output_limit` or
`interrupted`. At most eight streams attach to a container. Closing a stream only
detaches. Results and cancellation remain available to the authenticated owner
after the container stops and during billing outages, until retention expires.
Expired, foreign-generation or missing records return 404 `execution_not_found`.

New execution admission requires paid access and a running generation. On a
runtime restart, unfinished jobs become `interrupted` and their matching container
generation stops to revoke orphan processes. This can terminate other work on that
generation. Jobs are never replayed automatically. Filesystem/process persistence
across stop or restart is not supported.
