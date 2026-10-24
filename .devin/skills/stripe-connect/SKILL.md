---
name: stripe-connect
description: Stripe Connect via Accounts v2 (Express dashboard, platform collects fees/owns losses), direct-charge Checkout with platform fee, Connect webhooks and the booking hold state machine
triggers: [user, model]
---

# Stripe Connect in Adapt

## Connected accounts — Accounts v2 (`stripe.v2.core.accounts`)
The platform account has **Accounts v1 creation disabled**; `accounts.create()` is rejected. Use v2 (stripe-node >= 23):
```ts
stripe.v2.core.accounts.create({
  display_name, contact_email: ownerEmail, dashboard: "express",
  identity: { country: env.STRIPE_CONNECT_COUNTRY.toLowerCase() },
  defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
  configuration: { merchant: { capabilities: { card_payments: { requested: true } } },
                   recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
  metadata: { tenant_id }, include: ACCOUNT_INCLUDE,
}, { idempotencyKey: `acct-create-${tenant_id}` });
```
- `requirements_collector` is derived by Stripe (= `stripe` for this combo); you cannot set it.
- `losses_collector: application` required a one-time Dashboard acknowledgment (Settings → Connect → Platform profile). Done.
- Express dashboard + `losses_collector: stripe` is `account_controller_unsupported_configuration` — do not try it.
- v2 accounts have no boolean flags. `accountFlags()` in `src/lib/stripe.ts` derives `charges_enabled` (merchant card_payments
  status active), `payouts_enabled` (stripe_balance.payouts active) and `details_submitted` (no currently_due/past_due entries).
  Always retrieve with `include: ACCOUNT_INCLUDE` or those fields are absent.
- Onboarding: `v2.core.accountLinks.create({ account, use_case: { type: "account_onboarding", account_onboarding: { refresh_url, return_url } } })`.
  `/api/connect/refresh` regenerates. "View payouts" `/api/connect/payouts` uses the v1 `accounts.createLoginLink` (works for v2
  accounts) and is gated on `details_submitted && charges_enabled`.
- `scripts/stripe-check.ts` creates, links and closes a throwaway account — run it after any change to the params.

## Checkout (direct charge)
`checkout.sessions.create(params, { stripeAccount })` with `payment_intent_data.application_fee_amount = applicationFee(dueNow)`
(`floor(amount*bps/10000) + fixed`, capped; platform pays Stripe processing fees so the fee includes them).
`begin_checkout()` in Postgres validates the manage token, extends the hold to now+31m and returns amount/currency/description;
the route never reads amounts from the request. `expires_at` = that hold expiry. `metadata.booking_id` + `client_reference_id`.

## Hold state machine
- `create_booking_hold()` / `book_class_spot()` → `pending`, `hold_expires_at = now()+31m`.
- `checkout.session.completed` → `confirm_booking()` returns the resulting status. If not `confirmed` (hold lost) →
  `refunds.create({ payment_intent, refund_application_fee: true }, { stripeAccount: event.account })` → `mark_refunded()`.
- `checkout.session.expired` / `async_payment_failed` → `release_booking()`.
- pg_cron `expire_holds()` every minute.
- `cancel_booking(booking, token | owner, now)` decides the refund: pending → none; confirmed within
  `rules.cancellationDeadlineHours` → refund; owner-initiated → always refund; after deadline → none. Route performs the
  Stripe refund then `mark_refunded()`.

## Webhook (`src/lib/webhook.ts`, pure, dependency-injected)
Signature (`constructEvent`) → `record_stripe_event()` (false ⇒ duplicate ⇒ 200) → dispatch. On handler error:
`forget_stripe_event()` + 500 so Stripe retries. `account.updated` re-fetches the v2 account to derive flags.
Tests sign synthetic events with `stripe.webhooks.generateTestHeaderString` against the real local DB
(`tests/stripe/webhook.test.ts`). Live: `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe`.
