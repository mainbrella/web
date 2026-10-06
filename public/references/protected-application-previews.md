<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Protected application previews

Protected previews are enabled on the isolated `mainbrella.dev` gateway after
live transport, Next.js/browser and account/generation isolation qualification. Check
`/capabilities` and use previews only when `previews.supported` is true.

Start the application's HTTP server in an owned container first. Then use
`POST /containers/previews?id=<id>&createdAt=<generation>` with
`{"port":3000,"ttlSeconds":900}`. API keys and login sessions are accepted;
cookie writes require trusted Origin. Requests are bounded to 1024 bytes.
The response is 201 with `{id, port, createdAt, expiresAt, url}`. `expiresAt`
is Unix milliseconds; `createdAt` identifies the container generation.
The HTTPS URL carries a bearer token in its hostname and is returned once.
Anyone possessing it can access that port. Treat it as a credential: share
deliberately and keep it out of logs, analytics and public artifacts.

Ports 1024–65535 are eligible; SSH and other privileged ports are excluded.
TTL is 60–3600 seconds, defaulting to 900, clipped to the hard container deadline.
At most eight grants and sixteen simultaneous HTTP requests/WebSockets are
allowed per container. Successful response headers and active WebSocket traffic
renew idle activity; quiet sockets do not. Issuance never extends the hard lease.
Requests preserve application paths, queries, methods and bodies, including
root-relative assets and WebSocket paths. Connection headers must arrive within
15 seconds; each WebSocket frame is limited to 1 MiB. A stopped/replaced
generation, expired lease/grant or revoked grant cannot accept new traffic.
Expiry and revocation close active runtime transports. Requests never start or
restart a machine. Worker restarts require reconnecting active transports.

- `GET /containers/previews?id=<id>&createdAt=<generation>` returns
  `{previews: [{id, port, createdAt, expiresAt}]}` with active metadata only.
  URLs, raw tokens and hashes are never returned by listing.
- `DELETE /containers/previews?id=<id>&createdAt=<generation>&previewId=<preview-id>`
  returns `{revoked:true}` with status 200 and is idempotent within that running
  generation. Only the owner can list, issue or revoke. All three endpoints
  currently require paid access and the exact running generation.
  Listing and revocation remain available when preview issuance is disabled,
  allowing owners to close existing transports during gateway shutdown.

Creation is not idempotent. If its response is lost, list and revoke the new
grant before issuing another link. A routing-index failure triggers grant
revocation. Partial issuance/revocation cleanup returns 503
`preview_reconciliation_required` with `previewId`; retry DELETE using that ID
and the same container generation. Until runtime revocation succeeds, existing
connections may remain active until their lease/grant expires. Other failures
return `previews_unavailable`; excess grants return 429 `preview_limit`.

The gateway runs on a separate registrable domain and has no account database
or login/billing routes. Cookies, Authorization, client-supplied platform/forwarding
headers and Referer are stripped; response cookies are stripped too. The runtime
sets Host, X-Forwarded-Host and X-Forwarded-Proto from the validated preview origin,
preserving the caller's Origin for application security checks. Application
responses disable caching and set a no-referrer policy. Cookie sessions and
absolute redirect rewriting are not supported.
Framework compatibility, CSP and service workers still require live
qualification. Operators can read `docs/preview-ingress.md` in the backend checkout.

Local SDK helpers are `sandbox.previews.create(port, {ttlSeconds})`, `.list()` and
`.revoke(previewId)` in JavaScript, and `sandbox.previews.create(port, ttl_seconds=…)`,
`.list()` and `.revoke(preview_id)` in Python. Create returns the one-time URL
and metadata; list returns `{previews: [...]}` without URLs. Reconciliation errors
expose `previewId` in JavaScript and `preview_id` in Python. See the
[JavaScript](https://mainbrella.com/sdk/javascript.md) and
[Python](https://mainbrella.com/sdk/python.md) local SDK references.
