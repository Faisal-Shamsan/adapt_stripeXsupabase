import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";
import { createConnectedAccount, createOnboardingLink } from "@/lib/stripe";

/** Owner starts Stripe onboarding: create the connected account if needed, then redirect to the account link. */
export async function GET(req: Request) {
  try {
    const tenantId = z.string().uuid().parse(new URL(req.url).searchParams.get("tenant"));
    const { owner, tenant } = await requireOwner(tenantId);

    let accountId = tenant.stripe_account_id;
    if (!accountId) {
      const acct = await createConnectedAccount(tenant.id, owner.email, tenant.name);
      rpcData(await admin().rpc("attach_stripe_account", { p_tenant: tenant.id, p_owner: owner.id, p_account_id: acct.id }));
      accountId = acct.id;
    }

    const link = await createOnboardingLink(accountId, tenant.id);
    return NextResponse.redirect(link.url, 303);
  } catch (e) {
    return toResponse(e);
  }
}
