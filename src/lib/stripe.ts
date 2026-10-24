import Stripe from "stripe";
import { env } from "./env";
import { platformFee } from "@/engine/pricing";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) client = new Stripe(env().STRIPE_SECRET_KEY, { typescript: true });
  return client;
}

export const HOLD_MINUTES = 31;

export const ACCOUNT_INCLUDE: Stripe.V2.Core.AccountCreateParams.Include[] = ["configuration.merchant", "configuration.recipient", "requirements", "defaults"];

/**
 * Accounts v2 connected account: Express dashboard, platform collects fees and owns losses
 * (Stripe therefore collects KYC requirements). Equivalent of the v1 controller block.
 */
export function connectedAccountParams(tenantId: string, ownerEmail: string | null, displayName: string): Stripe.V2.Core.AccountCreateParams {
  return {
    display_name: displayName,
    ...(ownerEmail ? { contact_email: ownerEmail } : {}),
    dashboard: "express",
    identity: { country: env().STRIPE_CONNECT_COUNTRY.toLowerCase() },
    defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    metadata: { tenant_id: tenantId },
    include: ACCOUNT_INCLUDE,
  };
}

export function createConnectedAccount(tenantId: string, ownerEmail: string | null, displayName: string): Promise<Stripe.V2.Core.Account> {
  return stripe().v2.core.accounts.create(connectedAccountParams(tenantId, ownerEmail, displayName), { idempotencyKey: `acct-create-${tenantId}` });
}

export function retrieveConnectedAccount(accountId: string): Promise<Stripe.V2.Core.Account> {
  return stripe().v2.core.accounts.retrieve(accountId, { include: ACCOUNT_INCLUDE });
}

export type AccountFlags = { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean };

/** Derive the three flags we persist from a v2 account (needs ACCOUNT_INCLUDE on retrieval). */
export function accountFlags(a: Stripe.V2.Core.Account): AccountFlags {
  const chargesEnabled = a.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  const payoutsEnabled =
    a.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === "active" ||
    a.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status === "active";
  const entries = a.requirements?.entries ?? [];
  const detailsSubmitted = !entries.some((e) => e.minimum_deadline?.status === "currently_due" || e.minimum_deadline?.status === "past_due");
  return { chargesEnabled, payoutsEnabled, detailsSubmitted };
}

export function createOnboardingLink(accountId: string, tenantId: string): Promise<Stripe.V2.Core.AccountLink> {
  const base = env().NEXT_PUBLIC_APP_URL;
  return stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${base}/api/connect/refresh?tenant=${tenantId}`,
        // The return route re-syncs account flags from Stripe before showing the dashboard (webhooks may lag or, locally, never arrive).
        return_url: `${base}/api/connect/return?tenant=${tenantId}`,
      },
    },
  });
}

/** Express dashboard login (v1 endpoint; works for v2-created accounts). */
export function createPayoutsLoginLink(accountId: string): Promise<Stripe.LoginLink> {
  return stripe().accounts.createLoginLink(accountId);
}

export type CheckoutInput = {
  bookingId: string;
  tenantSlug: string;
  stripeAccountId: string;
  currency: string;
  dueNowCents: number;
  description: string;
  customerEmail: string;
  expiresAt: Date;
  /** Customer's manage token: the confirmation page needs it to show the booking after Stripe redirects back. */
  manageToken: string;
};

export function applicationFee(amountCents: number): number {
  const e = env();
  return platformFee(amountCents, { bps: e.PLATFORM_FEE_BPS, fixedCents: e.PLATFORM_FEE_FIXED_CENTS });
}

/** Direct charge on the connected account with our application fee. Amount is always computed server-side. */
export function createCheckoutSession(input: CheckoutInput): Promise<Stripe.Checkout.Session> {
  const base = env().NEXT_PUBLIC_APP_URL;
  return stripe().checkout.sessions.create(
    {
      mode: "payment",
      customer_email: input.customerEmail,
      client_reference_id: input.bookingId,
      metadata: { booking_id: input.bookingId },
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: { currency: input.currency, unit_amount: input.dueNowCents, product_data: { name: input.description } },
        },
      ],
      payment_intent_data: { application_fee_amount: applicationFee(input.dueNowCents), metadata: { booking_id: input.bookingId } },
      success_url: `${base}/${input.tenantSlug}/booking/${input.bookingId}?token=${input.manageToken}&paid=1`,
      cancel_url: `${base}/${input.tenantSlug}/booking/${input.bookingId}?token=${input.manageToken}&cancelled=1`,
    },
    { stripeAccount: input.stripeAccountId, idempotencyKey: `checkout-${input.bookingId}-${input.expiresAt.getTime()}` },
  );
}

/** Full refund including our application fee, on the connected account. */
export function refundPayment(stripeAccountId: string, paymentIntentId: string, idempotencyKey: string): Promise<Stripe.Refund> {
  return stripe().refunds.create(
    { payment_intent: paymentIntentId, refund_application_fee: true },
    { stripeAccount: stripeAccountId, idempotencyKey },
  );
}
