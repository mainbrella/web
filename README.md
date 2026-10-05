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
Signed-out customers selecting a plan are redirected to `/login` and returned to
pricing after sign-in. Stripe collects card details directly; Mainbrella never
receives them. Account-linked subscriptions use the Stripe billing portal.
For existing guest purchases, contact support@mainbrella.com for billing changes
or cancellation.

Google login is available at `/login` (redirecting to `/login/`), using the same
credentialed `/auth/me`, `/auth/google`, and `/auth/logout` flow as AHP Tour.
The default client ID is
`854186419005-l0u2olqlqe40qmgin0q8tjpvftooi6ac.apps.googleusercontent.com`
in `src/auth.js` and `../backend/wrangler.jsonc`. Optional `VITE_GOOGLE_CLIENT_ID`
and `VITE_API_URL` overrides support other environments; the backend client ID
must match. Billing login returns to pricing after sign-in.

The backend allowlists the plan prices:
- Builder: `price_1UNAovGSUs8K8zgHwUCsCX16`
- Pro: `price_1UNAWSGSUs8K8zgHXfnoTiJE` (unchanged)
- Scale: `price_1UNAq1GSUs8K8zgHnt8PplRQ`

Only the monthly plan is charged by checkout; compute usage billing and public
sandbox access are not implemented here. Published features describe planned tiers.

Before deploying, apply `../backend/migrations/003_pro_billing.sql` with
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
read directly from Stripe on every billing request, including renewals and
cancellations; this flow does not depend on a webhook or the checkout redirect.
