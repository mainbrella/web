# website

```sh
npm ci
npm run dev       # Vite development server
npm test          # Browser client tests (Node 22.15+)
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
npm run doctor    # Read-only agent setup diagnostics (MAINBRELLA_API_KEY)
npm run verify:agent # Create, execute hello over HTTP, and clean up; consumes one start
```

Builder ($5/month), Pro ($180/month), and Scale ($999/month) use Stripe's
inline Payment Element, adapted from Cubacadabra's checkout helper. Customers
sign in with Google before entering email and payment details on Mainbrella.
The homepage pricing buttons open `/pricing/builder`, `/pricing/pro`, or
`/pricing/scale`. Signed-out customers are redirected to `/login` with the selected
plan route as `returnTo`; after sign-in that route opens checkout automatically.
Existing subscribers see their subscription status and billing management instead.
Plan details, billing FAQs, and subscription management are available at `/pricing/`. The homepage links to pricing without loading payment code; Stripe.js loads only when checkout opens. Plan-specific routes use `pricing/checkout.html`, copied to the three plan directories at build time. Stripe collects card details directly; Mainbrella never
receives them. Subscribers change plans or cancel from the pricing section;
payment updates use the Stripe billing portal. Upgrades open a hosted Stripe
confirmation, while downgrades and cancellations take effect at the next renewal.
For existing guest purchases, contact support@mainbrella.com for billing changes
or cancellation.

Visitors who reject cookies can browse public pages. Login and account features show a cookie message with a “Change cookie choice” button that reopens the original two-choice dialog. Sign-in providers and advertising pixels wait for “Accept All”; rejection is remembered without a cookie.

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
grant tier-specific limits: Builder allows 5 concurrent containers, 1,000 starts
per UTC month, one-hour sessions and a 10-minute idle timeout; Pro allows
100 concurrent containers, 10,000 monthly starts, 24-hour sessions and a
30-minute idle timeout; Scale allows 500 concurrent containers, 100,000 monthly
starts, 72-hour sessions and a 60-minute idle timeout. All plans offer five sizes (Lite through XL), with 250 / 9,000 / 50,000 monthly compute-unit hours and 28 / 128 / 640 concurrent units. Each creation reserves a
start even if stopped early; a pending start counts toward concurrency.
Creation without an active paid subscription returns 402.
Containers have outbound internet access for package installation. Save workspaces explicitly to preserve filesystem snapshots for restore; ordinary stop discards unsaved changes. The dashboard
refreshes status every 15 seconds while visible; status reads do not renew the
idle lease. Subscription failures do not prevent container management.

Run `npm run deploy:preflight` in `../backend` before rollout. Its default `npm run deploy` gates and deploys the private `UserContainer` Worker with its account coordinator first, then the API. This ensures runtime support exists before API capability advertisement. Follow [the backend release runbook](../backend/docs/deployment.md), including migrations and explicit paid verification scope. Deploy this website afterward. Container IDs and configuration come from the backend, never the
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

Run `npm run deploy` in `../backend` to run the compatibility preflight, deploy
the private container Worker with the published image map, then deploy the API.
Follow [the deployment runbook](../backend/docs/deployment.md) and deploy the
website afterward. GitHub Actions builds the image; local backend deployments do
not require Docker. Existing containers using the old image must be stopped and
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
in [SKILL.md](SKILL.md). Lifecycle, execution, images, and SSH issuance accept named `mb_` API keys as Bearer credentials. The backend enforces the same paid tier limits for
UI and API calls. The backend API.md/SKILL.md and SDK READMEs are authoritative. Run `npm run docs:sync` after changing them; `npm run docs:check` validates the public copies, indexed reference tree, llms-full.txt and installable skill archive. Both repository CI workflows check agreement.

The homepage's five-step agent setup prompt links to `/SKILL.md` and `/API.md`.
Vite serves these source files in development and emits them verbatim into `dist/`,
along with `/mainbrella-doctor.mjs` and `/mainbrella-verify.mjs`; no public document
copies need maintaining. Run `npm test` and `npm run build` before deployment.
The verification command requires Node 22+, an API key,
active access, and available allowance. Avoid concurrent launches during setup.
Production verification must confirm hello output, exit code 0, and cleanup;
mocked tests do not satisfy that live release gate.

To install the skill in Codex, extract `public/skills/mainbrella-containers-0.1.0.tar.gz` into `.agents/skills/` (or the agent’s equivalent directory), then invoke `$mainbrella-containers`. The archive includes canonical instructions and indexed API/SDK references. Provision `MAINBRELLA_API_KEY`
separately using the instructions in `API.md`.

## Public website

Public pages use shared static navigation and footer markup from
`scripts/site-chrome-plugin.mjs`, rendered by Vite in development and production.
Use `<!-- site-header -->` and `<!-- site-footer -->` in public HTML pages.
Authenticated application screens retain their existing navigation.

The human-facing documentation starts at `/docs/`, with guides for containers,
execution, files, images, SSH, authentication, limits, errors, API reference, and
agent setup. `API.md`, `SKILL.md`, OpenAPI, and the onboarding scripts remain the
technical sources; update the corresponding HTML guides when contracts change.
New routes must also appear in `vite.config.js` and `public/sitemap.xml`.

`/security/`, `/security/disclosure/`, and `/.well-known/security.txt` publish
implemented controls and the reporting address. Renew the security.txt expiry
before October 1, 2027. Company and legal pages identify Andrew Arrow, doing
business as Mainbrella Co., a sole proprietorship, and the supplied notice address.

`/status/` reads bounded observations and incident history from the API. The scheduled collector observes website/API reachability and authentication-database availability; this does not establish successful login, provisioning, SSH, builds or billing. Unobserved or stale components remain unknown. Synthetic provisioning requires a dedicated account, monitoring secret and explicit start budget.
`/changelog/` records dated, source-linked product updates.

All plans support five sizes through 4 vCPU and 12 GiB RAM. Runtime is reserved before launch, unused runtime is released on stop, and machine deadlines enforce the account budget. See API.md for the compute contract.

## P1 public pages and evidence

`/benchmarks/` preserves the historical 381 ms P50 / 528 ms P95 creation result
(30 successes) and 680 ms P95 burst result (100 successes). The original test date,
region, machine/image configuration, cache semantics, raw samples, and harness
are not in this repository. Do not fill those gaps using today's configuration.
The new `/mainbrella-benchmark.mjs` measures the authenticated HTTP workflow,
including retries, first-command validation, byte verification, and cleanup;
it does not reproduce the old prototype protocol. Run it only with authorization
to consume the requested starts, retain its version with the JSON samples, and
publish failures and cleanup outcomes. No paid benchmark was run for this change.

`/integrations/` has Codex and Claude Code skill recipes and an OpenAI Agents SDK
function-tool example using `/integrations/mainbrella-command.mjs`. The command
adapter binds a trusted container generation and leaves creation and cleanup to
the application. Choose a machine size appropriate to agent orchestration and its tool workload. Local
contract tests and current official framework documentation validate these
recipes; a live agent/provider run remains a separate account-dependent check.
No framework or SDK dependencies were added to the website.

`/trust/` summarizes current security, data handling, continuity, and DPA
availability. `/subprocessors/` lists the Cloudflare, Google, and Stripe services
identified in the Privacy Policy, with linked provider processing-location
information reviewed October 5, 2026. Exact workload/database placement and the
support email provider have not been independently established here. Identify
that communications provider before representing the list as exhaustive for a
contractual DPA. The footer links to DPA **availability**, not an unsigned DPA.
Self-service plans have no SLA, support response-time guarantee, or service credits.

`/platform/` replaces Availability with compute placement, runtime availability,
limits, and service access. `/download`, `/download/`, and `/download/index.html`
redirect in Vite and through the built Cloudflare assets `_redirects` file.

The Contact page invites real “Built with Mainbrella” submissions; obtain explicit
publication permission and verify each project before publishing any customer
story, logo, or quote. No customer proof is fabricated. `/status/` distinguishes
historical benchmark observations from production metrics: total starts, 30-day
start success, and API uptime need verified operational data before publication.
It links to the latest recorded release date and platform placement information.
A signable DPA requires business readiness and legal review outside this web task.

## P2 public pages

`/blog/` contains five engineering articles on account reservations and Cloudflare
compute, startup measurement, idempotency and generations, browser/SSH access,
and custom images. Articles describe the existing web API documentation and
client code; publication dates do not establish feature release or benchmark dates.
Keep article claims aligned with the linked guides when contracts change. Add new
articles to the blog index, `vite.config.js`, and `public/sitemap.xml`.

`/compare/` is a Mainbrella-authored comparison reviewed October 6, 2026, covering
dedicated agent sandboxes, elastic compute primitives, raw VMs, app platforms,
and cloud development workspaces. It cites official sources and does not rank
speed because the platforms lack a common benchmark. Recheck those sources and
update the review date whenever changing prices or capabilities. Daytona's
archived public core repository reports that core development moved private in
June 2026; do not describe it as the current open-source hosted platform.

`/brand/` exports the existing transparent umbrella PNG and light/dark wordmarks,
with SVG and PNG downloads, usage guidance, and a ZIP under `public/brand/assets/`.
The SVGs embed the original raster umbrella; no native vector source exists here.
Wordmark PNGs are 1040 × 256. The 1440 × 900 screenshots show the public homepage
and Quickstart, captured locally without account or customer data. The homepage
API example is illustrative. Refresh the screenshots and ZIP when those assets
change; keep the capture date and `usage.txt` accurate.

`/careers/` is an expression-of-interest contact page for Andrew, with no advertised
open roles. Add job listings only when real roles and hiring details are supplied.
