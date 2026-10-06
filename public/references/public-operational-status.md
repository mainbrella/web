<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Public operational status

`GET /status` returns overall `state`, `generatedAt`, `staleAfterMs`, seven component
observations and up to 50 incidents, with active incidents first. Components are website, API, authentication,
provisioning, SSH, images and billing. Observations include `scope` (reachability,
control plane or synthetic workflow), latency and timestamp. Missing evidence or
evidence older than 15 minutes becomes unknown. Active incidents prevent an overall
operational state. No credentials or account information appear in public status.

`GET /status/history` returns up to 100 observations with 31-day retention. Filter
by `component`; paginate using returned `next.before` and `next.beforeId` together.
No availability percentage is inferred from missing samples.

`POST /internal/status/observations` and `/internal/status/incidents` require the
dedicated `MONITORING_SECRET` Bearer credential. Account API keys are not accepted.
The first accepts `{observations:[{component,state,scope,latencyMs?}]}` with at most
seven distinct components and a server-assigned timestamp. The second accepts
`{id,component,title,state,message}`; id is a UUID and state is investigating,
identified, monitoring or resolved. An incident cannot change component or reopen
after resolution. Incident text is public.
