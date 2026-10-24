/**
 * Register (or reuse) the Connect webhook endpoint for a deployment and print its signing secret.
 *   npx tsx scripts/stripe-webhook.ts https://your-app.vercel.app
 * The secret is only shown by Stripe at creation time; reuse prints "(already exists)" and you must
 * roll the secret in the Stripe Dashboard if you lost it.
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import Stripe from "stripe";

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "account.updated",
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
];

async function main() {
  const base = process.argv[2]?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) throw new Error("usage: stripe-webhook.ts https://your-app.example");
  const url = `${base}/api/webhooks/stripe`;
  const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"]!);

  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url);
  if (existing) {
    console.log(`webhook already exists: ${existing.id} (${existing.status}) connect=${existing.application ? "app" : String(existing.metadata?.["connect"] ?? "?")}`);
    console.log("secret is not retrievable after creation — roll it in the Dashboard if needed");
    return;
  }
  const w = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, connect: true, description: "Adapt — Connect events", metadata: { connect: "true" } });
  console.log(`created ${w.id} for ${url}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${w.secret}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
