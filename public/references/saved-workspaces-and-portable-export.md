<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Saved workspaces and portable export

Discover `capabilities.persistence.snapshots` before issuing saves or restores. Saved-workspace issuance is enabled in the qualified production deployment; other deployments may disable it. Ordinary stop remains destructive; save explicitly before stopping.

`POST /workspaces` accepts `{id, createdAt, name, stop?}` and requires an `Idempotency-Key`. The source identity must match a running generation owned by the authenticated account. Save captures the writable root filesystem, commits its private provider handle, and optionally stops that exact generation. Persist the request body and key before sending: repeat the identical request after a lost response. Recovery receipts last 24 hours. A capture whose provider result cannot be recovered fails closed rather than silently taking another snapshot.

`GET /workspaces` lists account-owned metadata, limits and reserved usage. `GET /workspaces/{uuid}` reads one; `PATCH` renames it or sets `{archived:true|false}`; `DELETE` releases customer quota and revokes future restores. Archive retains quota. Reads, archive and deletion remain available during subscription outages or disabled issuance. Provider handles never appear in public responses. Deletion does not erase provider-held bytes immediately and does not terminate a restore already admitted.

Restore with `POST /containers` and `{workspaceId}` using a new persisted creation key. A restore consumes one normal start and compute allowance and creates a fresh generation. It retains the saved machine size and internet policy, requires the same deployed image digest, and fails before admission if expired, archived or incompatible. A provider restore failure never falls back to an empty filesystem. RAM and running processes are not restored. Existing previews and generation-bound commands do not transfer.

| Plan | Saved workspaces | Reserved capacity | Retention | Saves/month | Capture capacity/month | Retained capture capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Usage | 20 | 160 GB | 14 days | 100 | 400 GB | 400 GB |
| Builder (legacy) | 3 | 8 GB | 7 days | 10 | 20 GB | 20 GB |
| Pro | 20 | 160 GB | 14 days | 100 | 400 GB | 400 GB |
| Scale | 100 | 1,000 GB | 29 days | 500 | 2,000 GB | 2,000 GB |

Each new save reserves the full source disk capacity against both capture budgets before contacting the provider, even if the resulting snapshot is smaller. Failed or uncertain saves keep their reservations; identical keyed retries do not charge again. Monthly counts/bytes reset at UTC calendar month boundaries. Retained capture capacity stays charged for at least 60 days, covering customer retention plus the provider's 30-day TTL after the last restore; daily buckets may retain earlier captures for up to one extra day. Archive, deletion, expiry and subscription changes do not refund these capture budgets. Deletion releases only live workspace count/capacity. Existing workspaces keep their original expiry. Legacy usage is migrated conservatively: saves whose records are unavailable reserve the maximum supported disk capacity.

`GET /workspaces` includes `maxCaptureBytesPerMonth` and `maxRetainedCaptureBytes` in `limits`, and `savesThisMonth`, `captureBytesThisMonth`, and `retainedCaptureBytes` in `usage`. New saves return HTTP 429 with `workspace_quota_exceeded`, `workspace_save_limit`, `workspace_capture_budget_exceeded`, or `workspace_retained_budget_exceeded` when the corresponding limit is reached. Reads, restores of otherwise eligible workspaces, archive and deletion remain available when a save budget is exhausted.

Reservation uses the source machine's full disk capacity, even when the snapshot is smaller. Expiry releases quota and removes usable handles; the provider controls physical retention. Backup to your own storage with `GET /containers/export?id=…&createdAt=…`: this returns a gzip tar archive of `/workspace`, limited to 16 MiB compressed and 60 seconds. Export a restored saved workspace to download it. Export excludes other root paths, mounted volumes and process memory, and fails if the archive exceeds the limit or files change during capture. It shares the four-operation limit with other filesystem operations.
