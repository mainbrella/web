<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Browser billing endpoints

Billing mutations require the login cookie and a trusted browser Origin.
Bearer automation credentials do not authorize purchases or plan changes.

| Method and path | Result |
| --- | --- |
| `GET /subscription/config` | Public server plan definitions and billing availability. |
| `GET /subscription` | Current Stripe subscription, paid `active`, `plan`, `valid_until` (Unix ms), `scheduled_plan`, and `scheduled_change_at` (Unix seconds). |
| `POST /subscription/checkout` with `{"plan":"usage"}` | Creates/reuses account-owned embedded checkout for the $5 monthly minimum; requires a saved payment method and rejects an existing live subscription. New legacy purchases are unavailable. |
| `POST /subscription/complete` with `{"session_id":"cs_..."}` | Verifies owned checkout completion and current paid entitlement. |
| `POST /subscription/portal` with `{"plan":"pro"}` | Stripe confirmation URL for an upgrade with immediate invoiced proration. |
| `POST /subscription/portal` with `{}` | Payment methods and invoice history portal URL. |
| `POST /subscription/change` with `{"plan":"usage","confirm":true}` | Explicitly migrates an existing legacy subscription at renewal. Existing legacy downgrades remain supported. Select the current plan to remove a scheduled change. |
| `GET /subscription/usage` | Current billing period, measured compute, estimated bill, reserved cost, spending cap and usage alert. |
| `POST /subscription/usage` with `{"spendLimitCents":5000,"authorizeOverages":true}` | Sets the account spending cap. Any cap above the default $5 requires explicit overage authorization. |
| `POST /subscription/cancel` with `{"confirm":true}` | Cancels at paid period end and removes a pending downgrade. |
| `POST /subscription/resume` with `{}` | Resumes a subscription pending period-end cancellation. |
| `POST /subscription/webhook` | Stripe signature authenticated; private integration for live entitlement reconciliation and renewal/final usage invoicing. |

Use the web billing controls for explicit user confirmation. Never perform a
purchase, plan change or cancellation as part of an ordinary container job.
