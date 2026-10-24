---
name: stripe-connect
description: Stripe Connect Express-dashboard accounts (controller properties), direct-charge Checkout with platform fee, Connect webhooks and the booking hold state machine
triggers: [user, model]
---

# Stripe Connect in Adapt

## Connected accounts (Accounts v1, controller properties — NOT `type: "express"`)
```ts
stripe.accounts.create({
  controller: {
    stripe_dashboard: { type: "express" },
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
  },
  country: env.STRIPE_CONNECT_COUNTRY,          // default DE
  email: ownerEmail,
  capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  metadata: { tenant_id },
}, { idempotencyKey: `acct-create-${tenant_id}` });
```
If Stripe rejects this combination, stop and surface the exact `StripeError.message` to the user — do not fall back silently.
Store `stripe_account_id`; `charges_enabled`, `payouts_enabled`, `details_submitted` are synced from `account.updated`.

- Onboarding: `accountLinks.create({ account, refresh_url, return_url, type: "account_onboarding" })`.
  `refresh_url` hits `/api/connect/refresh`, which regenerates a link and redirects (links are single-use, ~5 min).
- "View payouts" (owner-only, only when `details_submitted && charges_enabled`): `stripe.accounts.createLoginLink(acctId)` → 302 to `url`.
- `0007_connect_express.sql` nulled any pre-existing (full-dashboard) `stripe_account_id` so those tenants re-onboard.

## Checkout (direct charge)
`checkout.sessions.create(params, { stripeAccount })` with
`payment_intent_data.application_fee_amount = platformFee(amount, { bps: PLATFORM_FEE_BPS, fixedCents: PLATFORM_FEE_FIXED_CENTS })`
(`src/engine/pricing.ts`: `floor(amount*bps/10000) + fixed`, capped at amount). `expires_at = now + 31 min`,
`metadata.booking_id`, `client_reference_id = booking_id`. Amount from `chargeFor()` using stored config (`full` or `deposit`). Never trust the client.

## Hold state machine
`create_booking_hold()` → `pending`, `hold_expires_at = now()+31m`.
- `checkout.session.completed` → `confirm_booking(booking_id, payment_intent)`. If status ≠ pending (hold expired/released) →
  `refunds.create({ payment_intent, refund_application_fee: true }, { stripeAccount })` and mark `refunded`.
- `checkout.session.expired` / `async_payment_failed` → `release_booking()` (allocations `active=false`, status `cancelled`).
- pg_cron `expire_holds()` every minute releases `pending` past `hold_expires_at`.
- Cancellation within `rules.cancellationDeadlineHours` → refund incl. fee → `refunded`; after → `cancelled`, no refund.

## Webhooks (Connect endpoint)
Raw body → `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`. First statement:
`INSERT INTO stripe_events(event_id, type) ... ON CONFLICT DO NOTHING RETURNING event_id` — no row ⇒ already processed ⇒ 200.
Handle `account.updated` (sync the three flags), `checkout.session.completed|expired|async_payment_failed`.
Local: `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe`.
Test: `stripe trigger checkout.session.completed --override checkout_session:metadata.booking_id=<id>`; replay twice for idempotency.
