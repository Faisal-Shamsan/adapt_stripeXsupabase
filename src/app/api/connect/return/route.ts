import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";
import { accountFlags, retrieveConnectedAccount } from "@/lib/stripe";

/**
 * Stripe sends the owner here after onboarding. Re-fetch the connected account and sync the flags through the
 * same function the webhook uses, so the dashboard is correct immediately (and in local dev, where webhooks
 * never arrive). Then land on the dashboard.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = z.string().uuid().parse(url.searchParams.get("tenant"));
    const { tenant } = await requireOwner(tenantId);

    let outcome = "return";
    if (tenant.stripe_account_id) {
      try {
        const flags = accountFlags(await retrieveConnectedAccount(tenant.stripe_account_id));
        rpcData(await admin().rpc("sync_stripe_account", { p_account_id: tenant.stripe_account_id, p_charges: flags.chargesEnabled, p_payouts: flags.payoutsEnabled, p_details: flags.detailsSubmitted }));
      } catch (e) {
        console.error("connect return: could not sync account", tenant.stripe_account_id, e);
        outcome = "error";
      }
    }
    return NextResponse.redirect(new URL(`/dashboard/${tenant.id}?connect=${outcome}`, url.origin), 303);
  } catch (e) {
    return toResponse(e);
  }
}
