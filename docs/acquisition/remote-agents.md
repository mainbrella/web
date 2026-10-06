# Remote coding agents product plan

The proposed experience is a developer launching a coding agent on Mainbrella, closing the laptop, and reconnecting from another device to inspect work or answer an approval request. This is a future product: today's browser terminal and managed executions detach within a temporary machine's existing lease, and filesystem snapshots do not resume running processes or conversations.

Build and qualify session continuity before making that promise on a landing page. A Mac companion and phone controls should extend the same account, machine, and agent-session model rather than introducing another independent control plane. The existing product directions in `../mac.plan.md`, `../mac.plan2.md`, and `../roadmap.md` live at the Mainbrella workspace root.

## First usable version

Start with one supported coding agent and a web interface that works on a phone. Choose the first adapter from interviews with the initial users. The intended command shape is `mainbrella codex` or `mainbrella claude`; those commands do not exist as managed-agent launch commands today.

The first flow should clone a chosen repository, authenticate using a supported provider flow, launch a named remote session, detach without stopping the job, and reconnect to the same session. Show the current task, output, preview, files, and a clear stop control. Start from committed remote Git state; local uncommitted-work handoff can come after the basic workflow is reliable.

## Required platform work

1. **An agent-session lifecycle distinct from a browser connection.** Disconnecting a client must not count as idle execution. Define execution activity, hard runtime limits, budget reservations, explicit stop behavior, and what happens at renewal or allowance exhaustion. Do not solve this with a laptop-side heartbeat that stops when the laptop closes.
2. **A supported remote process and state contract.** Use the current managed execution and attach primitives where appropriate. Preserve transcript references and artifacts. Specify whether provider restart interrupts the job, resumes a saved conversation, or requires a new task; filesystem restore alone cannot promise process continuity.
3. **Provider-specific authentication and approvals.** Keep credentials out of transcripts and previews. Model an approval request with a session, operation, expiration, and single-use response. A phone approval must apply only to the operation shown and fail when stale. A generic shell tunnel is not an approval protocol.
4. **Reconnect and event history.** Persist task status and enough cursor-based events to reconnect after loss of a network connection. Distinguish running, awaiting approval, completed, interrupted, failed, and stopped. Never infer completion solely from a disconnected stream.
5. **Phone control.** Reuse account ownership and existing activity channels. Show compact session rows, recent output, approvals, previews, and completion artifacts. Add push notifications once missed approvals are a demonstrated problem; avoid requiring a native app to validate the first workflow.

Builder currently caps a session at one hour and has a ten-minute idle timeout. Pro and Scale allow longer sessions, also with idle and compute limits. Decide pricing and machine size from measured agent tasks. Do not advertise $5/month as unlimited unattended agent hosting or remove budget caps to manufacture continuity.

## Acceptance criteria

- A task continues on the remote host with the launching laptop offline for the agreed runtime and budget.
- A second authenticated device attaches to the same task and sees consistent output and state.
- A pending approval appears with the correct operation; an expired or duplicate approval cannot execute work.
- A completed task exposes its actual result or failure, with files or a diff the developer can inspect.
- A stop request terminates the intended task, and a restarted machine cannot receive an old session's inputs.
- Allowance exhaustion, hard deadline, and provider restart produce explicit interruption states and preserve the artifacts promised by the state contract.
- Billing and account boundaries remain enforced across concurrent sessions and both client devices.

A successful demo can then show fifteen seconds: launch a real task, close the laptop, see it still running on a phone, answer a real approval, and inspect the result. Record the demonstrated conditions and limits. Until these criteria pass on the deployed product, keep that video and headline out of paid acquisition.
