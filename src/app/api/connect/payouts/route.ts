import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";
import { createPayoutsLoginLink } from "@/lib/stripe";

/** "View payouts": owner-only Express dashboard login. Only once onboarding is complete. */
export async function GET(req: Request) {
  try {
    const tenantId = z.string().uuid().parse(new URL(req.url).searchParams.get("tenant"));
    const { tenant } = await requireOwner(tenantId);
    if (!tenant.stripe_account_id || !tenant.details_submitted || !tenant.charges_enabled) {
      throw new HttpError(409, "complete Stripe onboarding first");
    }
    const link = await createPayoutsLoginLink(tenant.stripe_account_id);
    return NextResponse.redirect(link.url, 303);
  } catch (e) {
    return toResponse(e);
  }
}
