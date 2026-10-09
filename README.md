# website

```sh
npm ci
npm run dev       # Vite development server
npm test          # Browser client and tool tests (Node 22.15+)
npm run type-check # Strict TypeScript checks, including browser tests
npm run build     # Type-check, then build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
npm run deploy:redirect # Deploy the www.mainbrella.com redirect
npm run doctor    # Read-only agent setup diagnostics (MAINBRELLA_API_KEY)
npm run verify:agent # Create, execute hello over HTTP, and clean up; consumes one start
```

`www.mainbrella.com` uses a separate Worker configured in
`wrangler.redirect.jsonc`. It returns a permanent 301 redirect to
`https://mainbrella.com`, preserving paths and query strings. Deploying it
provisions the custom domain's DNS and TLS through Cloudflare.

Browser code in `src/`, its tests, the Vite configuration, and build plugins use
strict TypeScript. Vite compiles browser modules to JavaScript; `tsx` runs the
TypeScript tests. The public `/homepage.js` asset is compiled from
`src/homepage.ts`. Downloadable `.mjs` tools and their Node scripts remain
JavaScript so users can run them directly without a TypeScript toolchain.

Builder ($5/month), Pro ($180/month), and Scale ($999/month) use Stripe's
inline Payment Element, adapted from Cubacadabra's checkout helper. Customers
sign in with Google before entering email and payment details on Mainbrella.
The pricing buttons open `/pricing/builder`, `/pricing/pro`, or
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
in `src/auth.ts` and `../backend/wrangler.jsonc`. Optional `VITE_GOOGLE_CLIENT_ID`
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
Start the frontend with `npm run dev` from this directory. If the backend uses a
different port or origin, set `VITE_API_URL` when starting Vite, for example
`VITE_API_URL=http://localhost:9000 npm run dev`. When local project hosting is
enabled, aliases use one label such as `app.localhost`; DNS and TLS checks are
simulated, so click Verify DNS twice to activate an alias.
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
`scripts/site-chrome-plugin.ts`, rendered by Vite in development and production.
Use `<!-- site-header -->` and `<!-- site-footer -->` in public HTML pages.
Authenticated application screens retain their existing navigation.

The human-facing documentation starts at `/docs/`, with guides for containers,
execution, files, images, SSH, authentication, limits, errors, API reference, and
agent setup. `API.md`, `SKILL.md`, OpenAPI, and the onboarding scripts remain the
technical sources; update the corresponding HTML guides when contracts change.
New routes must also appear in `vite.config.ts` and `public/sitemap.xml`.

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
articles to the blog index, `vite.config.ts`, and `public/sitemap.xml`.

`/compare/` is a Mainbrella-authored comparison reviewed October 6, 2026, covering
remote coding-agent products and phone control planes (Cursor, Codex Cloud, and
Runloop Reflex), agent hosts and sandboxes, elastic compute primitives, raw VMs,
app platforms, and cloud development workspaces. It separates today's Mainbrella
capabilities from the proposed agent-control direction in `../mac.plan2.md`, and
distinguishes worktree transfer from live session migration. It cites official sources and does not rank
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

## Acquisition pages and funnel

`/e2b-alternative/`, `/daytona-alternative/`, and `/cloudflare-sandbox/` target
specific agent-compute search intents. Shared chrome loads consent-aware funnel
tracking on public and application pages. Copy `.env.example` to `.env.local` and
set `VITE_GA_MEASUREMENT_ID` to enable GA4 at build time; it remains disabled when
that setting is empty. Disable GA4 Enhanced Measurement for this web stream and
verify events before using them to evaluate a campaign.

[The acquisition runbook](docs/acquisition/README.md) includes event definitions,
coverage limits, ad copy, developer outreach, a creator brief, tracking CSVs, and a
seven-day experiment. Generate creator links with
`npm run acquisition:link -- creator_slug e2b youtube`.
The small backend email-auth change supplies `created` for accurate new-account
counts; deploy it with the web changes. Browser tracking covers dashboard machine
starts; direct API activation still requires server-side measurement or manual
verification. The [remote-agent plan](docs/acquisition/remote-agents.md) defines
the additional work required before promising laptop-independent coding agents.

## Internal networking copy

The homepage, Daytona alternative, comparison, platform page and container docs
describe the October 7 Private Services HTTP prototype. The backend API.md is
authoritative; run `npm run docs:sync` after changing it. Production does not
yet advertise `networking.privateServices`; require an explicit true capability.

Daytona’s linked-sandbox contract was reviewed October 7, 2026. The supported
Mainbrella comparison is flexible membership of existing machines and independent
lifecycles, with named HTTP service routing and generation checks. Do not claim
full transport parity, production qualification, better isolation or faster
networking. Daytona documents same-runner linked children, DNS aliases and direct
port connections. Its linked children are ephemeral and parent deletion cascades.

## Run a GitHub repository

`/run/` accepts a GitHub URL and generates a setup prompt. **Copy prompt** sends
the instructions to the clipboard for ChatGPT or Claude to inspect the repository
and return JSON containing `repo`, `ref`, `catalogId`, `size`, `cwd` and optional
`setupCommand`, `startCommand` and `port`. No sign-in, paid access, or API requests
are needed to copy. Container verification requires an explicit request; available
API credentials alone do not authorize compute usage.

**Paste AI configuration** accepts JSON or a complete AI response containing one
configuration. It validates fields against the launch contract, shows all commands
for review and enables **Run repository**. Multiple configurations are rejected.
Editing the pasted response invalidates the previous configuration until the new
response passes validation. Importing never allocates or executes commands.
Existing links with configuration query parameters continue to work.

The recipient signs in before launch; paid or trial access is required. Small is the
default. The API resolves a commit before allocation, clones to `/workspace/repo`,
and opens the existing terminal component there. Optional setup/start commands,
working directory and port enable a web preview. All imported or linked commands
are shown before Run.

New imported settings remain in same-tab session storage, referenced by a short
`#config` fragment through sign-in; commands are not put in URLs. An uncertain
submission retains its configuration with the request ID for same-tab resumption.
Drafts cannot be transferred to another tab by copying the URL; paste the JSON there.
Private launch IDs live in the URL fragment and are preserved through login.
**Copy configuration** shares JSON pinned to the launched commit. Reloading a private launch
reconciles retained progress and exact generations. Failed setup keeps the shell
available. **Copy Codex prompt** on an active run includes its exact container
generation and execution IDs so an agent can finish or repair setup in that
container. Copy failure reveals selectable prompt text. Preview renewal reconciles one-time grants; cookie-based applications
are unsupported. The driver advances between phases while this page is open.

Deploy with the backend repository-launch API and D1 migration 013. See
`../backend/docs/repo-launches.md` for qualification and SDK CLI release steps.

# name ideas

| Repo name            | Umbrella association            |
| -------------------- | ------------------------------- |
| `brolly`             | British slang for umbrella      |
| `bumbershoot`        | Playful word for umbrella       |
| `canopy`             | Fabric covering of an umbrella  |
| `cloudburst`         | Sudden intense rain             |
| `cloudy`             | Clouds before rain              |
| `collapse`           | Folding an umbrella closed      |
| `compact`            | Pocket-sized umbrella           |
| `cover`              | Keeps things protected          |
| `defense`            | Protection from threats         |
| `deploy`             | Putting an umbrella into action |
| `downpour`           | Heavy rain                      |
| `drizzle`            | Light rain                      |
| `fabric`             | Material covering the frame     |
| `flying`             | Umbrella-powered flight         |
| `fold`               | Collapsible umbrella            |
| `forecast`           | Predicting umbrella weather     |
| `galoshes`           | Classic waterproof boots        |
| `gamp`               | Old-fashioned umbrella term     |
| `glide`              | Mary Poppins-style travel       |
| `gust`               | Sudden burst of wind            |
| `hail`               | Frozen precipitation            |
| `hailstorm`          | Storm producing hail            |
| `handle`             | Where you hold it               |
| `haven`              | Place of safety                 |
| `hook`               | Curved umbrella handle          |
| `hurricane`          | Massive storm                   |
| `inverted`           | Umbrella blown inside out       |
| `levitate`           | Floating through the air        |
| `lightning`          | Electrical storm                |
| `monsoon`            | Seasonal heavy rains            |
| `nylon`              | Common umbrella material        |
| `open`               | Opening an umbrella             |
| `overcast`           | Cloud-covered sky               |
| `parasol`            | Umbrella designed for sun       |
| `poppins`            | Mary Poppins flying             |
| `pongee`             | Water-resistant fabric          |
| `portable`           | Easy to carry                   |
| `privacy`            | Umbrella as a visual barrier    |
| `puddle`             | Rainwater collecting            |
| `rainbow`            | Appears after rain              |
| `rainboots`          | Footwear for rainy days         |
| `raincoat`           | Companion rain protection       |
| `raindance`          | Ritual associated with rain     |
| `raindrop`           | Individual drop of rain         |
| `rainfall`           | Rain coming down                |
| `refuge`             | Safe place during storms        |
| `repellent`          | Water-repelling surface         |
| `ribs`               | Structural supports             |
| `romance`            | Sharing an umbrella             |
| `sanctuary`          | Protected space                 |
| `shade`              | Protection from sunlight        |
| `shadow`             | Area sheltered from light       |
| `shaft`              | Central pole                    |
| `shelter`            | Protection from weather         |
| `shield`             | Defense against elements        |
| `shower`             | Brief rainfall                  |
| `sidewalk`           | Walking with umbrellas          |
| `singin-in-the-rain` | Famous musical reference        |
| `sleet`              | Frozen rain                     |
| `snowflake`          | Snow and winter weather         |
| `spokes`             | Umbrella's radial supports      |
| `splash`             | Water hitting the ground        |
| `storm`              | Severe weather                  |
| `streetlight`        | Rainy nighttime streets         |
| `sunbeam`            | Ray of sunlight                 |
| `sunblock`           | UV protection                   |
| `sunburn`            | What umbrellas help prevent     |
| `sunshine`           | Sunny weather                   |
| `taxi`               | Hailing a cab in the rain       |
| `thunder`            | Sound of a storm                |
| `tip`                | End of an umbrella              |
| `tornado`            | Extreme wind                    |
| `travel`             | Umbrellas on the go             |
| `unfurl`             | Spreading the canopy            |
| `updraft`            | Rising air that lifts umbrellas |
| `waterproof`         | Repels water                    |
| `weather`            | Overall conditions              |
| `wind`               | Wind that flips umbrellas       |
| `windproof`          | Resistant to strong wind        |

| Repo name       | Umbrella association                     |
| --------------- | ---------------------------------------- |
| `awning`        | Outdoor overhead rain and sun protection |
| `beach`         | Beach umbrellas                          |
| `boots`         | Rain boots                               |
| `brella`        | Short for umbrella                       |
| `bucket`        | Collecting rainwater                     |
| `cape`          | Waterproof rain cape                     |
| `cats-and-dogs` | Raining cats and dogs                    |
| `climate`       | Weather conditions                       |
| `cloak`         | Protective outerwear                     |
| `cloud`         | Source of rain                           |
| `coat`          | Raincoat                                 |
| `condensation`  | Formation of water droplets              |
| `deluge`        | Torrential rain                          |
| `dew`           | Morning moisture                         |
| `doppler`       | Weather radar                            |
| `drain`         | Carries away rainwater                   |
| `drip`          | Falling water droplets                   |
| `droplet`       | Tiny drop of water                       |
| `drought`       | Absence of rain                          |
| `dry`           | What umbrellas keep you                  |
| `dryclean`      | Keeping clothing dry                     |
| `drydock`       | Shelter from water                       |
| `eaves`         | Roof edges that divert rain              |
| `flood`         | Excessive rainwater                      |
| `fog`           | Suspended water droplets                 |
| `fountain`      | Water spraying                           |
| `goretex`       | Waterproof breathable fabric brand       |
| `gutter`        | Channels rainwater                       |
| `hood`          | Raincoat head covering                   |
| `humidity`      | Moisture in the air                      |
| `macintosh`     | Classic waterproof raincoat              |
| `mist`          | Fine airborne water                      |
| `mackintosh`    | Traditional waterproof coat              |
| `oilskin`       | Waterproof clothing material             |
| `overshoes`     | Waterproof shoe covers                   |
| `petrichor`     | Smell of rain on dry ground              |
| `poncho`        | Waterproof outer garment                 |
| `pour`          | Heavy rainfall                           |
| `precipitation` | Rain, snow, sleet, hail                  |
| `raincheck`     | Postponement due to rain                 |
| `raindrops`     | Multiple drops of rain                   |
| `rainforest`    | Forest with heavy rainfall               |
| `rainmaker`     | Something that produces rain             |
| `rainstorm`     | Storm with heavy rain                    |
| `rainwater`     | Water collected from rain                |
| `rubber`        | Material used in rain boots              |
| `slicker`       | Waterproof rain jacket                   |
| `soaked`        | Completely wet                           |
| `soggy`         | Saturated with water                     |
| `sprinkle`      | Very light rainfall                      |
| `squall`        | Sudden violent wind and rain             |
| `tarpaulin`     | Waterproof protective sheet              |
| `tarp`          | Short for tarpaulin                      |
| `tempest`       | Violent storm                            |
| `trenchcoat`    | Classic rainwear                         |
| `tropical`      | Climate associated with heavy rain       |
| `umbrella`      | The object itself                        |
| `uv`            | Ultraviolet rays blocked by parasols     |
| `wet`           | Opposite of dry                          |
| `wellington`    | Wellington rain boots                    |

## Some especially good ones still missing

| Repo name              | Association                             |
| ---------------------- | --------------------------------------- |
| `penguin`              | The Penguin's trick umbrellas in Batman |
| `cocktail`             | Tiny cocktail umbrellas                 |
| `tiki`                 | Tropical drink umbrellas                |
| `beachball`            | Beach umbrella scene                    |
| `patio`                | Patio umbrellas                         |
| `market`               | Outdoor market umbrellas                |
| `golf`                 | Oversized golf umbrellas                |
| `caddy`                | Golf umbrella holder                    |
| `chimney`              | Mary Poppins rooftop imagery            |
| `chimneysweep`         | Mary Poppins                            |
| `practically-perfect`  | Mary Poppins catchphrase                |
| `supercalifragilistic` | Mary Poppins song                       |
| `parachute`            | Umbrella-like descent                   |
| `totes`                | Well-known umbrella brand               |
| `totesmagoats`         | Playful association with Totes          |
| `ella`                 | Rihanna's Umbrella                      |
| `ella-ella`            | Famous umbrella song refrain            |
| `under-my-umbrella`    | Rihanna reference                       |
| `raining-men`          | Famous song                             |
| `singing`              | Singin' in the Rain                     |
