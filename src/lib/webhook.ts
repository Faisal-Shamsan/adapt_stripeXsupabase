import type Stripe from "stripe";
import { accountFlags, type AccountFlags } from "./stripe";
import type { PaymentsDb } from "./payments-db";

export type WebhookDeps = {
  db: PaymentsDb;
  /** Verify + parse. Throws on bad signature. */
  constructEvent: (rawBody: string, signature: string) => Stripe.Event;
  /** Full refund incl. application fee on the connected account. */
  refund: (stripeAccountId: string, paymentIntentId: string, idempotencyKey: string) => Promise<{ id: string }>;
  /** Fetch the connected account with capabilities so flags can be derived (v2 events carry only the id). */
  retrieveAccountFlags: (accountId: string) => Promise<AccountFlags>;
};

export type WebhookResult =
  | { status: 200; body: { received: true; duplicate?: boolean; action?: string } }
  | { status: 400; body: { error: string } }
  | { status: 500; body: { error: string } };

const pi = (s: Stripe.Checkout.Session): string | null => (typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null));

/**
 * Connect webhook. Signature → idempotency (stripe_events) → dispatch. If processing throws after the event was
 * recorded we forget it and return 500 so Stripe retries; a replay of a processed event is a no-op 200.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResult> {
  if (!signature) return { status: 400, body: { error: "missing signature" } };
  let event: Stripe.Event;
  try {
    event = deps.constructEvent(rawBody, signature);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }

  const fresh = await deps.db.recordEvent(event.id, event.type);
  if (!fresh) return { status: 200, body: { received: true, duplicate: true } };

  try {
    const action = await dispatch(event, deps);
    return { status: 200, body: { received: true, action } };
  } catch (e) {
    await deps.db.forgetEvent(event.id).catch(() => undefined);
    console.error("webhook failed", event.id, event.type, e);
    return { status: 500, body: { error: "processing failed" } };
  }
}

async function dispatch(event: Stripe.Event, deps: WebhookDeps): Promise<string> {
  const connectedAccount = event.account ?? null;

  switch (event.type) {
    case "account.updated": {
      const acct = event.data.object;
      const flags = await deps.retrieveAccountFlags(acct.id);
      const tenant = await deps.db.syncAccount(acct.id, flags);
      return tenant ? `synced ${acct.id}` : `unknown account ${acct.id}`;
    }

    case "checkout.session.completed": {
      const session = event.data.object;
      const bookingId = session.metadata?.["booking_id"] ?? session.client_reference_id;
      if (!bookingId) return "no booking id";
      const status = await deps.db.confirmBooking(bookingId, pi(session), session.id);
      if (status === "confirmed") return `confirmed ${bookingId}`;
      // Hold was lost (expired/released) before payment landed: give the money back, fee included.
      const paymentIntent = pi(session);
      if (paymentIntent && connectedAccount) {
        const r = await deps.refund(connectedAccount, paymentIntent, `refund-lost-hold-${bookingId}`);
        await deps.db.markRefunded(bookingId, r.id);
        return `refunded lost hold ${bookingId}`;
      }
      return `lost hold ${bookingId} without payment intent`;
    }

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      const bookingId = session.metadata?.["booking_id"] ?? session.client_reference_id;
      if (!bookingId) return "no booking id";
      const released = await deps.db.releaseBooking(bookingId);
      return released ? `released ${bookingId}` : `already settled ${bookingId}`;
    }

    default:
      return `ignored ${event.type}`;
  }
}

export { accountFlags };
