# website

```sh
npm ci
npm run dev       # Vite development server
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
```

Builder ($5/month), Pro ($180/month), and Scale ($999/month) use Stripe's
inline Payment Element, adapted from Cubacadabra's checkout helper. Customers
sign in with Google before entering email and payment details on Mainbrella.
The homepage pricing buttons open `/pricing/builder`, `/pricing/pro`, or
`/pricing/scale`. Signed-out customers are redirected to `/login` with the selected
plan route as `returnTo`; after sign-in that route opens checkout automatically.
Existing subscribers see their subscription status and billing management instead.
Pricing remains available at `/#pricing`. Stripe collects card details directly; Mainbrella never
receives them. Account-linked subscriptions use the Stripe billing portal.
For existing guest purchases, contact support@mainbrella.com for billing changes
or cancellation.

Google login is available at `/login` (redirecting to `/login/`), using the same
credentialed `/auth/me`, `/auth/google`, and `/auth/logout` flow as AHP Tour.
The default client ID is
`854186419005-l0u2olqlqe40qmgin0q8tjpvftooi6ac.apps.googleusercontent.com`
in `src/auth.js` and `../backend/wrangler.jsonc`. Optional `VITE_GOOGLE_CLIENT_ID`
and `VITE_API_URL` overrides support other environments; the backend client ID
must match. Plan-specific billing login returns to the selected plan after sign-in.
Other logins default to `/dashboard/`; safe same-site `returnTo` destinations
take precedence. Profile remains available at `/profile/`, and the account menu
links to the dashboard. The authenticated dashboard reads `/subscription` and
shows None, Builder, Pro, or Scale based on active access. Failed status requests
show an error with retry rather than implying the user has no subscription.
Container listing, creation, and stopping use the cookie-authenticated
`GET`, `POST`, and `DELETE /containers` backend API. During development all
signed-in users receive the same fixed limits, regardless of subscription:
one `lite` container (1/16 vCPU, 256 MiB RAM, 2 GB disk), one-hour maximum
sessions, ten-minute inactivity timeout, and ten starts per UTC calendar month.
Each start reserves a full session from the allowance, even if stopped early;
repeat creation while already running does not consume another start.
Containers have no internet access or persistent filesystem. The dashboard
refreshes status every 15 seconds while visible; status reads do not renew the
idle lease. Subscription failures do not prevent container management.

Deploy `../reference` first to provision its private `UserContainer` Durable Object in `mainbrella-containers`,
then deploy `../backend` (with the `USER_CONTAINER` cross-Worker binding), then
this website. Container IDs and configuration come from the backend, never the
browser; the machine test token is not needed for this private binding.
The benchmark API remains separate. SSH access requires backend migration `005_ssh_access.sql`.
The ten-start limit conservatively bounds each user's runtime to ten hours:
2.5 GiB-hours of allocated memory, 20 GB-hours of disk, and up to 37.5
vCPU-minutes at the advertised lite capacity. Cloudflare's included allowances
are shared across the entire account, rather than renewed for each user; this
development quota is not a guarantee that the service runs within a $5 bill.

The backend allowlists the plan prices:
- Builder: `price_1UNAovGSUs8K8zgHwUCsCX16`
- Pro: `price_1UNAWSGSUs8K8zgHXfnoTiJE` (unchanged)
- Scale: `price_1UNAq1GSUs8K8zgHnt8PplRQ`

Only the monthly plan is charged by checkout; compute usage billing is not implemented here. Published features describe planned tiers.

Before deploying, apply all backend migrations (including `004_subscription_details.sql`) with
`npm run db:migrate:remote` from the backend, and configure its Stripe account key
with `npx wrangler secret put STRIPE_SECRET_KEY`. Enable the Stripe customer portal
with payment updates and cancellation. Add `https://mainbrella.com` (and
`http://localhost:5173` for development) to the Google OAuth client's authorized
JavaScript origins. Configure `STRIPE_PUBLISHABLE_KEY` with `npx wrangler secret put STRIPE_PUBLISHABLE_KEY`
using the same Stripe account and mode as the secret key. Deploy the backend and
website together; the checkout response now supplies a client secret instead of a
hosted URL.

For local development, run the backend on port 8787 and this site on port 5173.
Use matching Stripe test secret/publishable keys and test recurring prices in a local branch; the supplied
production price belongs to its Stripe account and mode. Subscription status is
read directly from Stripe. Account checkout completion and subscription status
requests save the verified plan, subscription ID, status, cancellation flag, billing
period end (Unix seconds), and sync timestamp in `pro_billing`. Existing account
subscriptions are backfilled on their next status request. A saved plan alone
does not indicate paid access: only `active` and `trialing` statuses grant access.
Ended subscriptions clear these fields on the next status request. Stripe changes
sync when the account next requests billing status; there is no webhook syncing
accounts in the background. Guest purchases remain in Stripe without a local
account billing record.


Dashboard Connect prepares a private SSH command using a 15-minute access token.
Install `cloudflared` on the user's computer, then paste the command into their
terminal. The connection goes through `ssh.mainbrella.com` to the Cloudflare
SSH gateway in `../ssh-gateway`, then to that user's running container. No
Mainbrella CLI or public IPv4 address is required. Tokens stop working when the
container stops or is recreated; sessions also end when access expires. The
one-hour container limit and ten-minute inactivity timeout still apply.

The gateway and API share the `SSH_GATEWAY_SECRET` Worker secret. The gateway
also needs a stable `SSH_HOST_KEY_B64` secret, generated separately from user SSH
keys. See `../ssh-gateway/README.md` for deployment. All gateway and user-container
runtime testing can run on Cloudflare without local Docker or OrbStack.
