import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";
import { createOnboardingLink } from "@/lib/stripe";

/** Account links are single-use and short-lived; Stripe sends the owner here to get a fresh one. */
export async function GET(req: Request) {
  try {
    const tenantId = z.string().uuid().parse(new URL(req.url).searchParams.get("tenant"));
    const { tenant } = await requireOwner(tenantId);
    if (!tenant.stripe_account_id) throw new HttpError(409, "onboarding not started");
    const link = await createOnboardingLink(tenant.stripe_account_id, tenant.id);
    return NextResponse.redirect(link.url, 303);
  } catch (e) {
    return toResponse(e);
  }
}
