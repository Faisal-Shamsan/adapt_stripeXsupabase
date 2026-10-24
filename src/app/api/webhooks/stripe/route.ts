import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { admin } from "@/lib/supabase/admin";
import { paymentsDb } from "@/lib/payments-db";
import { accountFlags, refundPayment, retrieveConnectedAccount, stripe } from "@/lib/stripe";
import { handleStripeWebhook } from "@/lib/webhook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const result = await handleStripeWebhook(rawBody, req.headers.get("stripe-signature"), {
    db: paymentsDb(admin()),
    constructEvent: (body, sig) => stripe().webhooks.constructEvent(body, sig, env().STRIPE_WEBHOOK_SECRET),
    refund: refundPayment,
    retrieveAccountFlags: async (id) => accountFlags(await retrieveConnectedAccount(id)),
  });
  return NextResponse.json(result.body, { status: result.status });
}
