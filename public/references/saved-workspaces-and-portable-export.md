<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Saved workspaces and portable export

Discover `capabilities.persistence.snapshots` before issuing saves or restores. Issuance is disabled until the runtime and API deployment have passed live qualification. Ordinary stop remains destructive; save explicitly before stopping.

`POST /workspaces` accepts `{id, createdAt, name, stop?}` and requires an `Idempotency-Key`. The source identity must match a running generation owned by the authenticated account. Save captures the writable root filesystem, commits its private provider handle, and optionally stops that exact generation. Persist the request body and key before sending: repeat the identical request after a lost response. Recovery receipts last 24 hours. A capture whose provider result cannot be recovered fails closed rather than silently taking another snapshot.

`GET /workspaces` lists account-owned metadata, limits and reserved usage. `GET /workspaces/{uuid}` reads one; `PATCH` renames it or sets `{archived:true|false}`; `DELETE` releases customer quota and revokes future restores. Archive retains quota. Reads, archive and deletion remain available during subscription outages or disabled issuance. Provider handles never appear in public responses. Deletion does not erase provider-held bytes immediately and does not terminate a restore already admitted.

Restore with `POST /containers` and `{workspaceId}` using a new persisted creation key. A restore consumes one normal start and compute allowance and creates a fresh generation. It retains the saved machine size and internet policy, requires the same deployed image digest, and fails before admission if expired, archived or incompatible. A provider restore failure never falls back to an empty filesystem. RAM and running processes are not restored. Existing previews and generation-bound commands do not transfer.

| Plan | Saved workspaces | Reserved capacity | Retention | Saves/month |
| --- | ---: | ---: | ---: | ---: |
| Builder | 3 | 24 GB | 7 days | 30 |
| Pro | 20 | 160 GB | 14 days | 300 |
| Scale | 100 | 2,000 GB | 29 days | 3,000 |

Reservation uses the source machine's full disk capacity, even when the snapshot is smaller. Expiry releases quota and removes usable handles; the provider controls physical retention. Backup to your own storage with `GET /containers/export?id=…&createdAt=…`: this returns a gzip tar archive of `/workspace`, limited to 16 MiB compressed and 60 seconds. Export a restored saved workspace to download it. Export excludes other root paths, mounted volumes and process memory, and fails if the archive exceeds the limit or files change during capture. It shares the four-operation limit with other filesystem operations.
