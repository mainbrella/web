<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Machine sizes and compute allowance

| Size | Cloudflare instance | vCPU | RAM | Disk | Compute units/hour |
| --- | --- | --- | --- | --- | --- |
| lite | lite | 1/16 | 256 MiB | 2 GB | 1 |
| small | standard-1 | 0.5 | 4 GiB | 8 GB | 6 |
| medium | standard-2 | 1 | 6 GiB | 12 GB | 10 |
| large | standard-3 | 2 | 8 GiB | 16 GB | 16 |
| xl | standard-4 | 4 | 12 GiB | 20 GB | 28 |

Builder includes 250 compute-unit hours/month and 28 concurrent units; Pro 9,000 and 128; Scale 50,000 and 640. Container ceilings and monthly start safeguards (1,000 / 10,000 / 100,000) also apply. Monthly usage resets on the UTC calendar month, without rollover.

Create with `{"catalogId":"node","size":"medium"}`. `GET /containers` returns `sizes`, `limits.maxComputeUnitHours`, `limits.maxConcurrentComputeUnits`, and `usage.computeUnitHours`, `reservedComputeUnitHours`, `availableComputeUnitHours`, and `concurrentComputeUnits`. Runtime is reserved durably before provisioning; unused runtime is released on a reconciled stop. Used hours include provisioning and idle time. Ambiguous starts retain reservations until reconciliation. Capacity rejection does not reserve usage. Machines receive an immutable budget deadline and stop at the earliest of that deadline, idle/session/paid-access expiry, or the UTC month boundary. Clients must honor returned `expiresAt`.

Errors: 400 `invalid_size`; 409 `compute_capacity_exceeded`; 429 `compute_allowance_exhausted`. A changed size with an existing creation key returns 409 `idempotency_key_conflict`. No automatic overages or top-ups are enabled.
