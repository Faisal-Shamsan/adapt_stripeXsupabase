---
name: stripe-connect
description: Stripe Connect Express onboarding, direct-charge Checkout with platform fee, Connect webhooks and the booking hold state machine
triggers: [user, model]
---

# Stripe Connect in Adapt

- Platform = us. Tenant = Express connected account (`tenants.stripe_account_id`, `charges_enabled`).
- Onboarding: `accounts.create({type:"express"})` → `accountLinks.create({refresh_url, return_url, type:"account_onboarding"})`.
  `account.updated` webhook syncs `charges_enabled`.
- Checkout: `checkout.sessions.create(params, { stripeAccount })` = **direct charge**. Include
  `payment_intent_data.application_fee_amount = round(amount * PLATFORM_FEE_BPS / 10000)`,
  `expires_at = now + 31 min`, `metadata.booking_id`, `client_reference_id = booking_id`.
  Amount from `src/engine/pricing.ts` using stored config (`full` or `deposit`). Never trust the client.
- Hold state machine: `create_booking_hold()` → `pending` with `hold_expires_at = now()+31m`.
  - `checkout.session.completed` → `confirm_booking(booking_id, payment_intent)`; if the hold already expired/was released
    (status ≠ pending) → `refunds.create({payment_intent, refund_application_fee: true}, {stripeAccount})` and mark `refunded`.
  - `checkout.session.expired` / `async_payment_failed` → `release_booking()` (allocations `active=false`, status `cancelled`).
  - pg_cron `expire_holds()` every minute releases `pending` past `hold_expires_at`.
- Webhook route: raw body, `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`; first statement is
  `INSERT INTO stripe_events(event_id) ... ON CONFLICT DO NOTHING RETURNING event_id` — no row ⇒ already processed ⇒ 200.
  This is the Connect endpoint: `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe`.
- Cancellation: within `rules.cancellationDeadlineHours` → refund (incl. fee) → `refunded`; after → `cancelled`, no refund.
- Testing: `stripe trigger checkout.session.completed --override checkout_session:metadata.booking_id=<id>`; replay the same
  event twice to prove idempotency.
