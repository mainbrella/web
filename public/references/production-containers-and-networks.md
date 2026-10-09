<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Production containers and networks

Usage subscriptions support `lifecycle: "production"` in `POST /containers`.
Omitted lifecycle remains `ad_hoc`, with the existing session and idle limits.
Production machines have no session or idle shutdown; five-minute compute
reservations renew automatically while paid access and the spending cap permit.
The account checks every 30 seconds, independently of dashboard visits. All
machines share the same monthly spending cap, concurrency and start safeguards.

```json
{"name":"api","catalogId":"node","size":"small","lifecycle":"production","startupCommand":"cd /workspace/app && npm start"}
```

A startup command must be one line and at most 4,096 characters. The dashboard
requires it; API callers can omit it for an always-on shell machine. The command
runs from the selected immutable image on every machine recovery. Include all
required setup in the image or command. Application processes are supervised
with restart backoff up to 60 seconds; output goes to
`/tmp/mainbrella-production.log`. Runtime recovery backs off from 30 seconds to
five minutes. Recovery retains the logical `id` and `createdAt`, private network
registration and project endpoint binding. Explicit deletion and subsequent
creation still produce a new identity. Recovery does not consume another account
start; it reserves and bills new runtime. Confirmed stopped intervals are not
billed. Idempotency retries retain their original creation identity across
recovery; changing lifecycle or startup command conflicts.

`GET /containers` includes production services with `status: "stopped"` and a
`stopReason` when compute is paused by the cap, payment or recovery backoff.
A production `expiresAt` is the current authorized compute lease, not a fixed
service lifetime. Cap or payment stops preserve desired state; verified paid
access and available cap allow automatic recovery. `DELETE /containers` removes
desired state before cleanup and permanently disables automatic recovery.

Create a production network with
`POST /private-services/networks {"name":"app","lifecycle":"production"}`.
Only production services can attach to it; Ad Hoc networks accept Ad Hoc
containers. A mismatch returns `409 network_lifecycle_conflict`. Optional
`lifecycle=ad_hoc|production` filters network listings before pagination. Existing
networks default to Ad Hoc. Empty networks allocate no compute and have no compute
charge. Networks remain private HTTP registries, with the existing protocol limits.

Production requires usage billing (`402 production_requires_usage`) and a
compatible private runtime (`503 production_unavailable`). Deploy the container
runtime before the account/API worker and web UI. Feature discovery and a
versioned private start route reject an incompatible runtime before provisioning.
Production cannot restore a saved workspace. There is no persistent disk,
transactional snapshot, HTTP readiness guarantee, replica failover or uptime SLA.
Use external durable storage. Payment renewal can interrupt compute until the
next billing period is proven paid; recovery resumes the same logical service.
