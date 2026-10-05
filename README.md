# website

```sh
npm ci
npm run dev       # Vite development server
npm test          # Browser client tests (Node 22.15+)
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
npm run doctor    # Read-only agent setup diagnostics (MAINBRELLA_API_KEY)
npm run verify:agent # Create, execute hello, and clean up; consumes one start
```

Builder ($5/month), Pro ($180/month), and Scale ($999/month) use Stripe's
inline Payment Element, adapted from Cubacadabra's checkout helper. Customers
sign in with Google before entering email and payment details on Mainbrella.
The homepage pricing buttons open `/pricing/builder`, `/pricing/pro`, or
`/pricing/scale`. Signed-out customers are redirected to `/login` with the selected
plan route as `returnTo`; after sign-in that route opens checkout automatically.
Existing subscribers see their subscription status and billing management instead.
Pricing remains available at `/#pricing`. Stripe collects card details directly; Mainbrella never
receives them. Subscribers change plans or cancel from the pricing section;
payment updates use the Stripe billing portal. Upgrades open a hosted Stripe
confirmation, while downgrades and cancellations take effect at the next renewal.
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
Container listing, creation, and stopping use the session-authenticated
`GET`, `POST`, and `DELETE /containers` backend API. Active paid subscriptions
grant tier-specific limits: Builder allows 5 concurrent containers, 10 starts
per UTC month, one-hour sessions and a 10-minute idle timeout; Pro allows
100 concurrent containers, 1,000 monthly starts, 24-hour sessions and a
30-minute idle timeout; Scale allows 500 concurrent containers, 10,000 monthly
starts, 72-hour sessions and a 60-minute idle timeout. All plans use `lite`
containers (1/16 vCPU, 256 MiB RAM, 2 GB disk). Each creation reserves a
start even if stopped early; a pending start counts toward concurrency.
Creation without an active paid subscription returns 402.
Containers have outbound internet access for package installation and no persistent filesystem. The dashboard
refreshes status every 15 seconds while visible; status reads do not renew the
idle lease. Subscription failures do not prevent container management.

Run `npm run deploy` in `../backend` to deploy the API first, then the private
`UserContainer` Worker in `mainbrella-containers` with its account coordinator.
This order ensures the API supplies paid entitlements before the private workers
start enforcing them. Deploy this website afterward. Container IDs and configuration come from the backend, never the
browser; the machine test token is not needed for this private binding.
The benchmark API remains separate. SSH access requires migrations `005_ssh_access.sql` and `007_ssh_container_id.sql`.
Cloudflare's included allowances are shared across the entire account, rather
than renewed for each user; plan limits are enforced by Mainbrella.

The backend allowlists the plan prices:
- Builder: `price_1UNAovGSUs8K8zgHwUCsCX16`
- Pro: `price_1UNAWSGSUs8K8zgHXfnoTiJE` (unchanged)
- Scale: `price_1UNAq1GSUs8K8zgHnt8PplRQ`

Only the monthly plan is charged by checkout; compute usage billing is not implemented here.

Before deploying, apply all backend migrations (including `006_billing_webhooks.sql` and `007_ssh_container_id.sql`) with
`npm run db:migrate:remote` from the backend, and configure its Stripe account key
with `npx wrangler secret put STRIPE_SECRET_KEY`. Enable the Stripe customer portal
with payment updates. Add `https://mainbrella.com` (and
`http://localhost:5173` for development) to the Google OAuth client's authorized
JavaScript origins. Configure `STRIPE_PUBLISHABLE_KEY` with `npx wrangler secret put STRIPE_PUBLISHABLE_KEY`
using the same Stripe account and mode as the secret key. Deploy the backend and
website together; the checkout response now supplies a client secret instead of a
hosted URL.

For local development, run the backend on port 8787 and this site on port 5173.
Use matching Stripe test secret/publishable keys and test recurring prices in a local branch; the supplied
production prices belong to their Stripe account and mode. The backend verifies
subscription state with Stripe, saves billing details in `pro_billing`, and
processes signed Stripe webhooks for subscription changes. A saved plan alone
does not indicate paid access: the backend requires an active subscription, a
paid invoice for its current period, and a successful payment that has not been
refunded or disputed. Trialing, overdue, unpaid, and expired subscriptions do not
grant access. Configure `STRIPE_WEBHOOK_SECRET` and the signed event endpoint
`/subscription/webhook` as described in the backend README. Existing guest purchases remain in Stripe without a
local account billing record.


The dashboard's primary **Open terminal** action opens an in-page xterm.js terminal.
It connects to the configured API origin over `/containers/terminal` using the
existing HttpOnly session cookie, with the expected `createdAt` generation and
initial `cols`/`rows`. The API validates Origin and session ownership before
forwarding a sanitized request to that account's private UserContainer. Neither
the browser nor this route can start a container or consume a monthly start.

The shell lives in the fixed tmux session `main`, so reloads and dropped
connections can reattach within the same container generation. The client
retries abnormal disconnects up to five times with 1–16 second exponential
backoff; clean exits do not reconnect. Keystrokes are binary UTF-8, resizes are
JSON `{cols, rows}`, and output is binary with JSON acknowledgements after
rendering for backpressure. Container disappearance or generation changes in
the existing status poll close the terminal. Input/output activity renews the
plan-specific idle deadline, but the independent alarm and terminal deadline never
extend the plan's hard session expiration. Closing the panel detaches the tmux client;
the shell continues only while the container's existing lease allows it.

Run `npm run deploy` in `../backend` to deploy the API first, then the container
Worker and its named Docker image (bash, tmux, Node 24). Deploy the website
afterward. GitHub Actions builds the image; local backend deployments do not
require Docker. Existing containers using the old image must be stopped and
recreated to gain tmux. No new token table, migration, CLI, or public port is
required for browser terminals.

The secondary **SSH** action still prepares a private command using a 15-minute
access token. Install `cloudflared` on the user's computer, then paste the command into their
terminal. The connection goes through `ssh.mainbrella.com` to the Cloudflare
SSH gateway in `../ssh-gateway`, then to that user's running container. No
Mainbrella CLI or public IPv4 address is required. Tokens stop working when the
container stops or is recreated; sessions also end when access expires. The
plan-specific session and inactivity limits still apply.

The gateway and API share the `SSH_GATEWAY_SECRET` Worker secret. The gateway
also needs a stable `SSH_HOST_KEY_B64` secret, generated separately from user SSH
keys. See `../ssh-gateway/README.md` for deployment. All gateway and user-container
runtime testing can run on Cloudflare without local Docker or OrbStack.

API automation instructions are in [API.md](API.md), with a reusable agent skill
in [SKILL.md](SKILL.md). Lifecycle, images, and SSH issuance accept named `mb_` API keys as Bearer credentials. The backend enforces the same paid tier limits for
UI and API calls. Keep these two
files synchronized with their copies in `../backend` when the API changes.

The homepage's five-step agent setup prompt links to `/SKILL.md` and `/API.md`.
Vite serves these source files in development and emits them verbatim into `dist/`,
along with `/mainbrella-doctor.mjs` and `/mainbrella-verify.mjs`; no public document
copies need maintaining. Run `npm test` and `npm run build` before deployment.
The verification command requires Node 22+, local SSH/cloudflared, an API key,
active access, and available allowance. Avoid concurrent launches during setup.
Production verification must confirm hello output, exit code 0, and cleanup;
mocked tests do not satisfy that live release gate.

To install the skill in Codex, copy `SKILL.md` and `API.md` into
`~/.codex/skills/mainbrella-containers/` (or the equivalent skills directory for
your agent), then invoke `$mainbrella-containers`. Provision `MAINBRELLA_API_KEY`
separately using the instructions in `API.md`.
