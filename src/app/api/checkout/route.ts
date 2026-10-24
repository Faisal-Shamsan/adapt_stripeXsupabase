import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { createCheckoutSession } from "@/lib/stripe";

const Body = z.object({ bookingId: z.string().uuid(), token: z.string().length(48) });

type BeginCheckout = {
  tenant_id: string;
  tenant_slug: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  currency: string;
  due_now_cents: number;
  description: string;
  customer_email: string;
  expires_at: string;
};

/** Customer pays for a pending hold. Amount, currency and expiry come from the database, never the client. */
export async function POST(req: Request) {
  try {
    const { bookingId, token } = Body.parse(await req.json());
    const sb = admin();

    const rows = rpcData<BeginCheckout[]>(await sb.rpc("begin_checkout", { p_booking: bookingId, p_token: token }));
    const c = rows[0]!;

    const session = await createCheckoutSession({
      bookingId,
      tenantSlug: c.tenant_slug,
      stripeAccountId: c.stripe_account_id,
      currency: c.currency,
      dueNowCents: c.due_now_cents,
      description: c.description,
      customerEmail: c.customer_email,
      expiresAt: new Date(c.expires_at),
    });
    rpcData(await sb.rpc("set_checkout_session", { p_booking: bookingId, p_session_id: session.id }));

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return toResponse(e);
  }
}
