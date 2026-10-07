<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Private Services between machines

Private Services is a local HTTP prototype, enabled by `LOCAL_DEV=true` or
explicit `PRIVATE_SERVICES_ENABLED=true` with both runtime bindings. Before
creating networks or attaching machines, require
`GET /capabilities` to return `networking.privateServices: true`; an absent or
false value means it is unavailable. Production support has not been qualified.

Create an account-owned named network, then attach exact running generations.
Register a backend as `api` with application port `8080`, and attach a frontend
as `web` without a port for caller-only access. From that frontend,
`curl http://api.internal/users` reaches the backend's registered port. The
platform supplies account and generation identity; guests need no Mainbrella
API key or public preview URL for this connection.

| Request | Body / behavior |
| --- | --- |
| `POST /private-services/networks` | `{"name":"app"}` creates an empty network (201). |
| `GET /private-services/networks` | Returns `{networks:[{name,members}]}` for the authenticated account. |
| `PUT /private-services/members?network=app` | `{"id":"<backend-id>","createdAt":"<exact-generation>","name":"api","port":8080}` registers a service (200). Omit `port` for a caller-only member. |
| `DELETE /private-services/members?network=app` | Send the member's exact `id`, `createdAt`, and `name` to detach it without stopping it. |
| `DELETE /private-services/networks?network=app` | Deletes an empty network; detach all members first. |

API keys and browser sessions are accepted; cookie mutations require a trusted
Origin. Creation and attachment require paid access and deployment enablement.
Listing and cleanup remain available when issuance is disabled. Network and
service names match `[a-z][a-z0-9-]{0,62}`. Each account has at most 16 networks,
each with at most 32 members; each generation belongs to one network. Service
names are unique within that network. Registered ports are 1024–65535.

Only plain HTTP on port 80 to `http://NAME.internal` is routed. Requests and
responses are each limited to 1 MiB, with a 10-second request timeout. HTTPS,
WebSockets, CONNECT, arbitrary TCP/UDP, private IPs and direct database protocols
are unsupported. Redirects are returned without being followed. This is service
routing, not a general private LAN or an egress firewall.

Both source and destination must be current, running, paid generations in the
same account-owned network. Stale membership cannot reach a stopped or replaced
generation; reattach a replacement explicitly. Delayed detach for an old
generation cannot remove its replacement. Detach does not undo an application
request already accepted. Membership never starts a machine, changes its internet
policy, or issues public previews. Machines retain independent deadlines and
stop behavior; deleting a member does not cascade to peers. To share a frontend
with a browser, issue a separate protected preview for that frontend only.
