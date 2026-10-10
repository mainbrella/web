<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Browser billing endpoints

Billing mutations require the login cookie and a trusted browser Origin.
Bearer automation credentials do not authorize purchases or plan changes.

| Method and path | Result |
| --- | --- |
| `GET /billing/config` | Public `{configured,minTopupCents:500,maxTopupCents:100000}`. |
| `GET /billing/balance` | `{balance}` with confirmed balance, available and reserved cents, monthly spending, production rate/runway and automatic recharge settings. |
| `POST /billing/topups` with `{"amountCents":2000,"requestId":"<uuid>"}` | Creates or recovers hosted one-time Stripe Checkout and returns `{url,sessionId}`. Reuse the same UUID and amount after an uncertain response. |
| `POST /billing/topups/complete` with `{"sessionId":"cs_..."}` | Verifies account-owned Checkout and live succeeded/captured card payment, then applies funding by immutable payment identity. Returns 200 `{balance}` only after verified payment; pending returns 409 `payment_pending`, expired returns 409 `topup_expired`. |
| `POST /billing/settings` with `{"spendLimitCents":5000}` | Sets the USD monthly consumption cap; raising it adds no funds. |
| `POST /billing/settings` with `{"autoRecharge":{"enabled":true,"amountCents":2000,"monthlyLimitCents":10000}}` | Explicitly authorizes $20 automatic recharges up to $100 per UTC month and saving the verified card. Both amounts are $5–$1,000 and maximum must cover at least one recharge. Pending payments count toward authorization and never fund runtime. |
| `GET /subscription/config` | Legacy plan policy plus `prepaid_configured` and `billing_model`. |
| `GET /subscription` | Effective entitlement; prepaid uses internal `plan:"usage"` with `subscription:null`. Existing legacy subscribers retain live Stripe reconciliation. |
| `POST /subscription/complete` with `{"session_id":"cs_..."}` | Reconciles a previously issued legacy subscription Checkout. |
| `POST /subscription/portal` with `{}` | Existing legacy payment methods and invoice history portal URL. |
| `GET /subscription/usage` | Existing legacy usage-subscription billing-period information. |
| `POST /subscription/cancel` with `{"confirm":true}` | Cancels at paid period end and removes a pending downgrade. |
| `POST /subscription/webhook` | Stripe signature authenticated; credits successful prepaid purchases and revokes refunded/disputed funding using live charge state. Existing legacy invoices and entitlement events remain supported. |

When `STRIPE_PREPAID_PRICE_ID` is configured, recurring Checkout, plan changes,
upgrades, resumption and legacy cap mutation return 409 `prepaid_billing_required`.
New purchases do not create a monthly subscription. Each dollar paid adds one
dollar of balance. Repeated $5 purchases and a larger single purchase have the
same value, compute prices and account limits; $180 funds the same balance as
36 purchases of $5, and $1,000 funds the same balance as 200 purchases of $5.

Use the web billing controls for explicit user confirmation. Never perform a
purchase, plan change or cancellation as part of an ordinary container job.
