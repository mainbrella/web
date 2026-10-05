# website

```sh
npm ci
npm run dev       # Vite development server
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
```

Pro subscriptions use Stripe-hosted Checkout and the billing portal. The backend
hard-codes `price_1UNAWSGSUs8K8zgHXfnoTiJE` for the $180/month plan; the frontend
cannot select a different price. Only the monthly plan is charged by this flow;
compute usage metering and billing are not implemented here.

Before deploying, apply `../backend/migrations/003_pro_billing.sql` with
`npm run db:migrate:remote` from the backend, and configure its Stripe account key
with `npx wrangler secret put STRIPE_SECRET_KEY`. Enable the Stripe customer portal
with payment updates and cancellation. Add `https://mainbrella.com` (and
`http://localhost:5173` for development) to the Google OAuth client's authorized
JavaScript origins. No Stripe publishable key is needed for hosted checkout.

For local development, run the backend on port 8787 and this site on port 5173.
Use a Stripe test secret and a test recurring price in a local branch; the supplied
production price belongs to its Stripe account and mode. Subscription status is
read directly from Stripe on every billing request, including renewals and
cancellations; this flow does not depend on a webhook or the checkout redirect.
