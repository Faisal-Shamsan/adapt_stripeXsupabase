import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { refundPayment } from "@/lib/stripe";
import { currentUser } from "@/lib/supabase/server";

const Body = z.object({ token: z.string().length(48).optional() });

type CancelRow = { refund: boolean; payment_intent: string | null; stripe_account_id: string | null; status: string };

/**
 * Cancel a booking. Customers authorise with the manage token; owners with their session.
 * The database decides whether a refund is owed (inside the cancellation deadline, or any owner cancel).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    z.string().uuid().parse(id);
    const { token } = Body.parse(await req.json().catch(() => ({})));
    const owner = token ? null : await currentUser();

    const rows = rpcData<CancelRow[]>(await admin().rpc("cancel_booking", { p_booking: id, p_token: token ?? null, p_owner: owner?.id ?? null }));
    const r = rows[0]!;

    if (r.refund && r.payment_intent && r.stripe_account_id) {
      const refund = await refundPayment(r.stripe_account_id, r.payment_intent, `refund-cancel-${id}`);
      rpcData(await admin().rpc("mark_refunded", { p_booking: id, p_refund_id: refund.id }));
      return NextResponse.json({ status: "refunded", refundId: refund.id });
    }
    return NextResponse.json({ status: "cancelled", refunded: false });
  } catch (e) {
    return toResponse(e);
  }
}
