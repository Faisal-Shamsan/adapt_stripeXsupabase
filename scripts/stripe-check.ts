// One-off: prove the platform account accepts our Accounts v2 configuration.
// Creates a throwaway connected account, prints the relevant fields, creates an onboarding link, then closes it.
import { config } from "dotenv";
config({ path: ".env.local" });

import { accountFlags, connectedAccountParams, stripe } from "../src/lib/stripe";

async function main() {
  const params = connectedAccountParams("00000000-0000-0000-0000-000000000000", "stripe-check@example.com", "Stripe Check");
  console.log("params:", JSON.stringify(params, null, 2));
  const acct = await stripe().v2.core.accounts.create(params);
  console.log("created:", {
    id: acct.id,
    dashboard: acct.dashboard,
    responsibilities: acct.defaults?.responsibilities,
    applied: acct.applied_configurations,
    card_payments: acct.configuration?.merchant?.capabilities?.card_payments?.status,
    flags: accountFlags(acct),
    requirements: (acct.requirements?.entries ?? []).map((e) => `${e.description} [${e.minimum_deadline?.status}]`).slice(0, 8),
  });
  const link = await stripe().v2.core.accountLinks.create({
    account: acct.id,
    use_case: { type: "account_onboarding", account_onboarding: { refresh_url: "http://localhost:3000/r", return_url: "http://localhost:3000/d" } },
  });
  console.log("account link ok:", link.url.slice(0, 48) + "...", "expires", link.expires_at);
  const login = await stripe().accounts.createLoginLink(acct.id).catch((e: { message: string }) => ({ url: `LOGIN LINK REJECTED: ${e.message}` }));
  console.log("login link:", login.url.slice(0, 60));
  const closed = await stripe().v2.core.accounts.close(acct.id, { applied_configurations: ["merchant", "recipient"] });
  console.log("closed:", closed.closed);
}

main().catch((e: { type?: string; code?: string; message: string; param?: string }) => {
  console.error("STRIPE REJECTED:", { type: e.type, code: e.code, param: e.param, message: e.message });
  process.exit(1);
});
