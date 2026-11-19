# Billing: going live

Pro is €5 a month, sold through Stripe on the shared 6x7 account. Today everything runs in Stripe
test mode and Pro shows "Coming soon" in production. This page is the order of work to change that,
and what each switch does. Do the steps in order; the order is what keeps it safe.

Plan limits (database enforced, mirrored in `src/lib/plans.ts`): Free is 10 saved songs and 100
assistant requests a month; Pro is 1000 songs and 2000 requests. Transcription and stem splitting run
on the player's device and are never metered.

## What the code does

- `POST /api/checkout` starts a Stripe Checkout for the Pro price. The user id, app (`riffscribe`) and
  plan go into the metadata so the webhook links the subscription without guessing by e-mail. A person
  already on Pro is sent to the portal instead of paying twice. One Stripe customer is kept per person
  and per Stripe mode in `riffscribe_customers`.
- `POST /api/portal` opens the Stripe billing portal.
- `POST /api/stripe/webhook` handles exactly nine events and drops the rest: `checkout.session.completed`,
  `customer.subscription.created`, `.updated` and `.deleted`, `invoice.paid`, `invoice.payment_failed`,
  `charge.refunded`, `charge.dispute.created` and `radar.early_fraud_warning.created`. It ignores
  events from other 6x7 apps on the shared account (metadata `app` must be `riffscribe`), ignores events
  from the other Stripe mode, and records each event id in `riffscribe_webhook_events` so a retry does
  nothing twice. The logic is in `src/lib/billing/webhookLogic.ts` and is unit-checked by
  `scripts/verify-billing.mjs`.
- `POST /api/withdraw` is the self-serve 14-day withdrawal: refund the first payment in full and end
  Pro now. It answers 404 until its flag is on.
- Stripe is pinned to API version `2026-08-26.dahlia` in `src/lib/stripe.ts`. Create the webhook
  endpoint on the same version.
- Pro is kept while a subscription is `past_due` (Stripe's retry window). It ends when Stripe gives
  up and cancels, plus a 3-day grace for rows nothing updates any more.

## The flags

All server-side flags are off unless set to the exact text `true`. Only `NEXT_PUBLIC_BILLING_ENABLED`
is public, and it is read when the site is built, so changing it needs a new deploy.

| Variable | Off means | Needs before you turn it on |
|---|---|---|
| `NEXT_PUBLIC_BILLING_ENABLED` | Pro shows "Coming soon", checkout is closed | everything below up to the smoke purchase |
| `STRIPE_TAX_ENABLED` | no VAT added, no tax-id collection | a VAT registration (Denmark, and the EU One Stop Shop scheme above the EUR 10,000 cross-border threshold); a Stripe Tax registration that shows Collecting. Ask the accountant. Without an active registration Stripe silently collects 0. |
| `STRIPE_TOS_CONSENT` | no "I agree to the terms" box at checkout | the terms URL under Stripe Settings, Public details |
| `STRIPE_AUTO_REFUND_EFW` | an early fraud warning is only recorded | a decision: refunding a EUR 5 charge costs less than the dispute fee that usually follows |
| `STRIPE_SELF_SERVE_WITHDRAWAL` | `/api/withdraw` is 404; the account page tells people to e-mail | legal sign-off on the button wording (EU rules require a clearly labelled online withdrawal function from 19 June 2026) |

## The order

1. **Deploy the release** (the release PR merged; `main` deploys). Nothing below changes behaviour
   until a flag is set.
2. **Apply the SQL.** After the deploy, in the Supabase SQL editor, in this order: `0003`, `0004`,
   `0005`, then `0006` and `0007`. See `supabase/README.md` for the table and for
   why 0004 and 0005 must wait for the deploy. `0006_billing.sql` adds `riffscribe_customers` and lets
   `past_due` keep Pro.
3. **Stripe Dashboard** (live mode, separate from test mode):
   1. Decide which legal entity owns the shared 6x7 account. Activation puts that company behind every
      6x7 app that sells through it. If only Riffscribe should sit under the company, open a separate
      account and swap the keys instead.
   2. Activate the account: company, registered address, representative, website `riffscribe.6x7.gr`
      (Stripe reviews the site, so the terms and privacy pages must be final first), support e-mail,
      statement descriptor.
   3. Add a bank account. Prices are in EUR; a DKK payout account pays a conversion fee on every
      payout. Turn on two-factor sign-in for every Dashboard user.
   4. Create the product "Riffscribe Pro" with a monthly EUR 5.00 price, tax behaviour inclusive, and a
      software-as-a-service tax code. Keep the `price_` id.
   5. Webhook endpoint: `https://riffscribe.6x7.gr/api/stripe/webhook`, API version `2026-08-26.dahlia`,
      the nine events above and no others. Keep the `whsec_` secret.
   6. Customer portal (configured separately in live mode): cancel at period end, update payment
      method, invoice history, billing address and tax id; plan switching off; return address
      `/account`; terms and privacy URLs.
   7. Settings, Public details: the terms and privacy URLs. Subscriptions and e-mails: successful
      payment receipts on, failed-payment and refund e-mails on, Smart Retries, and cancel the
      subscription after the last retry.
   8. Invoice template: company name, address, CVR and VAT number.
4. **Vercel environment, Production only** (Preview keeps the test values): `STRIPE_SECRET_KEY` as a
   *restricted* live key (Checkout Sessions, Customers, Subscriptions and the customer portal write;
   invoices, invoice payments, charges and disputes read; refunds write), `STRIPE_PRICE_PRO`,
   `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SITE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (already there).
   Mark the secrets Sensitive. Scope them to Production so a preview deploy cannot charge anyone.
5. **Clear the test-mode rows.** Review, then end them:
   ```sql
   select user_id, status, stripe_customer_id, stripe_subscription_id
   from subscriptions where app = 'riffscribe';
   update subscriptions set status = 'canceled', stripe_customer_id = null,
     stripe_subscription_id = null where app = 'riffscribe';
   ```
   No live event will ever update them and their `cus_` ids break the portal on a live key. Rows with
   app `global` belong to other 6x7 apps: review those with their owners, do not blanket-update.
6. **Smoke purchase** with your own card in live mode: subscribe, check the `subscriptions` row and the
   VAT line on the invoice, open the portal, cancel, then refund through the Dashboard and check that
   Pro switches off. If anything is off, stop here; no customer has paid.
7. **Open it:** set `NEXT_PUBLIC_BILLING_ENABLED=true` and redeploy. Then, one at a time and only when
   its row in the flag table is satisfied, `STRIPE_TAX_ENABLED`, `STRIPE_TOS_CONSENT`,
   `STRIPE_AUTO_REFUND_EFW`, `STRIPE_SELF_SERVE_WITHDRAWAL`.

## Before any of that

These are not code and block going live:

- The legal identity block in `src/lib/company.ts` (name, CVR, address, VAT id) is empty. The terms and
  privacy pages fall back to an "operated by 6x7" line until it is filled in.
- A lawyer's read of `src/app/terms/page.tsx` and `src/app/privacy/page.tsx`. The terms state a flat
  14-day full refund; that is a choice, not a legal requirement beyond the withdrawal right.
- Row-level security on the shared `subscriptions` and `app_access` tables (they are not in this
  repo). A table a browser can write to means a free Pro plan. Check it in the dashboard.
- Vercel: Hobby is not licensed for commercial use. Move to Pro before charging anyone.

## What this does not cover

- Refund bookkeeping is Stripe's; the webhook only ends the subscription.
- Prices are fixed at EUR 5. A second plan needs a new price id, a plan lookup change in
  `supabase/accounts.sql` (a new migration, never an edit) and `src/lib/plans.ts`.
- Nobody has completed a purchase against a live key. Everything above is checked only against test
  mode and unit tests (`scripts/verify-billing.mjs`).
