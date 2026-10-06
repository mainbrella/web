# Mainbrella first twenty active users

Run one acquisition experiment around a clear offer: a Linux computer for an AI agent, started by API, with commands, files, SSH, browser terminals, and web previews, from $5/month. Aim for twenty developers who run a real workload and return to run it again. Count paid subscriptions separately from coupon trials.

The landing pages and browser funnel events are implemented. GA4 needs a web-stream measurement ID before it collects these events. Outreach, creator bookings, ad spending, and the managed remote-agent product remain work to do.

## Landing pages and search campaigns

| Search intent | Destination | Suggested headline |
| --- | --- | --- |
| E2B alternative | `/e2b-alternative/` | E2B Alternative From $5/mo |
| Daytona alternative | `/daytona-alternative/` | Daytona Alternative |
| Cloudflare sandbox | `/cloudflare-sandbox/` | Cloudflare Agent Sandboxes |
| General agent compute | `/` | A Linux Computer For AI Agents |

Suggested descriptions:

- “Run commands, upload files, SSH in, and open web previews. Fixed monthly plans from $5.”
- “Give your agent a Linux computer. API access, custom images, and clear compute limits.”

For the first seven days, pause broad campaigns manually and test the E2B intent first. Use exact or phrase-match searches such as “e2b alternative” and “e2b sandbox alternative.” Start with a $30/day cap; increase toward $50/day only after machine starts are verified. Keep other ad groups paused until the first experiment produces useful evidence. Avoid competitor brand terms by themselves, which can bring login and documentation searches. Review search terms daily and exclude unrelated intent.

Example destination:

https://mainbrella.com/e2b-alternative/?utm_source=google&utm_medium=cpc&utm_campaign=e2b_alternative&utm_content=fixed_monthly

The current comparison copy links to [E2B pricing](https://e2b.dev/pricing), [Daytona pricing](https://www.daytona.io/pricing), and [Cloudflare Containers documentation](https://developers.cloudflare.com/containers/). Recheck provider claims when changing ads or page copy. Avoid claims of universal savings, compatibility with competitor SDKs, unlimited compute, or an always-on coding agent.

## Enable funnel reporting

1. Create a GA4 property and a web data stream for `https://mainbrella.com`. Copy its public `G-…` measurement ID into `VITE_GA_MEASUREMENT_ID` in `.env.local` or the build environment. See the root `.env.example`.
2. Disable Enhanced Measurement for this stream so automatic page, outbound-link, and form events do not bypass the explicit event scheme or include raw URLs. The implementation sends page locations without query strings or fragments and strips referrer queries. It disables GA4 collection when consent is rejected, using [Google’s documented opt-out flag](https://developers.google.com/tag-platform/security/guides/privacy).
3. Rebuild and deploy the website. Deploy the small backend email-auth response change as well; the new `created` flag distinguishes account creation from a returning email login. The existing Google response already supplies this flag. Without the backend update, email login works but email signups are not counted.
4. Register event-scoped custom dimensions for `entry_page`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and `creator`. `utm_term`, `plan`, `size`, and `placement` are available if needed. Campaign values must use letters, digits, underscores, and hyphens, up to 80 characters; use slugs rather than names or emails.
5. Validate accepted and rejected consent in a test browser. With acceptance, check events in GA4 Realtime. With rejection, funnel events and acquisition storage remain disabled. For DebugView, use Google's Analytics Debugger browser extension. [Google event setup](https://developers.google.com/analytics/devguides/collection/ga4/events) describes verification and reporting.
6. Create an open Funnel Exploration: `page_view` → `landing_engaged` → `quickstart_read` → `sign_up` → `payment_confirmed` → `machine_started`. Segment by `entry_page`, campaign, or creator. Also inspect each transition independently: users can legitimately skip Quickstart. Review `machine_return_next_day` separately as a retention measure. Mark `payment_confirmed` and `machine_started` as key events; optimize ads around starts once volumes permit.

| Event | Trigger |
| --- | --- |
| `page_view` | A page loads after consent, or consent is accepted on that page |
| `landing_engaged` | Ten cumulative visible seconds on the homepage or one of the intent pages, after consent |
| `quickstart_view` | `/docs/` loads after consent |
| `quickstart_read` | Ten cumulative visible seconds on `/docs/`, an engagement proxy rather than proof of reading |
| `cta_click` | A link to Builder checkout is clicked; `placement` records navigation, hero, footer, or content |
| `sign_up` | Successful Google or email authentication returns `created: true` |
| `login` | Successful authentication; returning users do not count as signups |
| `checkout_started` | The server returns a valid Stripe checkout configuration |
| `payment_confirmed` | Checkout completion returns an active subscription; a repeated checkout confirmation is deduplicated in this tab |
| `dashboard_view` | A dashboard load authenticates successfully, once per page load |
| `machine_started` | A dashboard create request succeeds |
| `machine_returned` | A machine is started on a later UTC day than this account's first observed web start on this browser |
| `machine_return_next_day` | That later start occurs on the immediately following UTC day |

First-touch landing and campaign attribution applies for thirty days; expired records are replaced on a later consented visit. Browser records remain until replaced or cleared. Account IDs are pseudonymous GA4 User IDs; emails, passwords, commands, file contents, and Stripe checkout IDs are not event parameters. Checkout IDs are held locally only for duplicate suppression. Storage blocking, consent rejection, deleted storage, ad blockers, and device changes reduce coverage. Payment confirmation measures active subscription access, not exact charged revenue; reconcile actual revenue and discounts in Stripe.

Browser `machine_started` counts dashboard starts. It cannot see an agent's direct API starts. Do not interpret a missing browser event as failed activation: verify API activity with the developer and backend account usage. Before optimizing a primarily API campaign, add authoritative successful-start and return-use measurement in the backend coordinator, with deduplication by account and container generation and attribution tied to signup. Avoid treating reserved starts as successful starts. Until that exists, the scorecard includes separate verified API and repeat-use columns.

Ad impressions and clicks come from the ad platform. Keep their totals separate from consented website visitors; these denominators have different coverage. Compare daily unique users for funnel steps rather than raw event counts. Record daily results in [scorecard.csv](scorecard.csv).

## Recruit developers with a current workload

Use [conversations.csv](conversations.csv) to record relevant discussions and follow-up dates. Aim for twenty new useful conversations per day for five days, fifty to one hundred conversations in total, and twenty developers who try their own workload. Search Reddit, GitHub discussions, HN, X, and community channels for people already asking about agent sandboxes, remote code execution, or E2B and Daytona costs. Follow each community's participation rules and help solve the question before introducing Mainbrella.

Suggested reply, after addressing their technical question:

> I've been building Mainbrella, an open-source platform on Cloudflare Containers. The hosted version gives an agent a Linux machine through an API, with SSH and browser access, from $5/month. If you're testing this kind of workload, I'd be happy to help you try it. It has explicit compute and session limits; what does your task need?

For someone evaluating migration:

> What calls does your agent use today—commands, files, previews, or persistence? Mainbrella has its own API and SDKs, so it takes an adapter change. If you can describe one representative job, I can help check whether it fits before you spend time migrating.

Offer hands-on onboarding using the Quickstart. A trial offer should use an intentionally issued, bounded coupon through the existing backend coupon tooling; an attribution link does not grant access or a discount. Keep provider credentials and API keys out of outreach and tracking files.

After the developer runs a real job, follow up the next week with one question:

> What would make you use this next week instead of whatever you normally use?

Record their actual answer. Prioritize fixes named repeatedly by active developers over additional infrastructure features.

## Pay creators for real use

Book five technical creators whose audience builds agents or developer tools. A planning range of $100–$500 per creator gives a $500–$2,500 total budget; agree scope and fee individually before booking. Track candidates and outcomes in [creators.csv](creators.csv). Audience fit, complete task demonstrations, and verified activations matter more than follower count.

Creator brief:

> Pick a real task you would normally perform with a local or hosted agent. Use Mainbrella for its Linux environment, and show the result, the setup steps, the machine size, the costs, and anything that breaks. Include commands, files, a terminal, or a web preview where they help the task. Give an honest opinion and disclose the sponsorship. There is no requirement for a positive review.

Possible tasks:

- Have an agent create a small Next.js app in a remote machine, then open its preview.
- Replace the command and file tools for one existing E2B workload and compare the integration effort.
- Build and serve a small app using a Mainbrella environment on Cloudflare.
- Install a coding agent in a suitably sized container and complete a bounded task within the plan's session and idle limits.
- Build a custom image for a repeatable agent task, then run it in two clean machines.

Deliverables: one reproducible demonstration, a video or detailed post, the exact plan and machine size used, a record of problems, and an attributed link. Do not publish private repositories, credentials, or customer data. “Close your laptop and the agent keeps working” is reserved for the future managed product, not a claim for these demonstrations.

Generate one unique link per creator and task destination:

```sh
npm run acquisition:link -- alex e2b youtube
npm run acquisition:link -- sam cloudflare youtube
npm run acquisition:link -- jordan home newsletter
```

The link sets `creator`, `utm_content`, and campaign `first20`; it does not create a coupon. Use stable, nonpersonal slugs. Compare unique signups, confirmed subscribers, web machine starts, verified API starts, and repeat users for each creator before booking more work.

## Seven day sequence

| Day | Work | Evidence to retain |
| --- | --- | --- |
| 1 | Configure GA4, publish the pages and backend signup flag, verify consent and events, pause broad campaigns manually | Verified event flow and page destinations |
| 2 | Start one small E2B search experiment; recruit developers with a current task | Search terms, spend, first twenty conversations |
| 3 | Help the first developers run their own jobs; invite suitable creator candidates | Actual workload results and onboarding failures |
| 4 | Continue relevant conversations; agree five creator task briefs within the chosen budget | Qualified candidates, links, agreed scopes |
| 5 | Fix the most repeated onboarding obstacle; review all funnel transitions | Verified machine starts and reasons for abandonment |
| 6 | Follow up early users; test the remote-agent product requirements with them | Repeat-use evidence and desired workflow |
| 7 | Review the twenty-user target and creator results; continue only channels producing activations | Cohort scorecard and next-week answers |

A large drop in click-through calls for a better ad and search terms. A drop after landing calls for clearer fit or trust. Paid users without machine starts need onboarding attention. Users who complete a workload but do not return need a better reason to choose the product again. Change one bottleneck at a time so the experiment stays interpretable.

For the longer-lived coding-agent wedge, see [remote-agents.md](remote-agents.md). Current machine deadlines remain explicit until that product is implemented and qualified.
