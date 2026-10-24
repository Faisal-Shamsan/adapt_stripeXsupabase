/**
 * Webhook handler against the real local database through the service-role adapter.
 * Events are signed with Stripe's own test signer, so signature verification is the production code path.
 * Stripe network calls (refund, account retrieval) are injected fakes that record their arguments.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { presets } from "@/engine/presets";
import { paymentsDb } from "@/lib/payments-db";
import { handleStripeWebhook, type WebhookDeps } from "@/lib/webhook";
import type { AccountFlags } from "@/lib/stripe";
import { applyConfig, createTenant, createUser, parse, pool } from "../db/_setup";

const SECRET = "whsec_test_" + "x".repeat(32);
const stripe = new Stripe("sk_test_dummy");

function signed(event: object): { body: string; sig: string } {
  const body = JSON.stringify(event);
  return { body, sig: stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) };
}

let evtCounter = 0;
const checkoutEvent = (type: string, bookingId: string, account: string, paymentIntent: string | null = `pi_${++evtCounter}`) => ({
  id: `evt_${++evtCounter}_${Date.now()}`,
  object: "event",
  type,
  account,
  api_version: "2025-02-24",
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 1,
  request: null,
  data: { object: { id: `cs_${evtCounter}`, object: "checkout.session", metadata: { booking_id: bookingId }, client_reference_id: bookingId, payment_intent: paymentIntent } },
});

const sb = createClient(process.env["NEXT_PUBLIC_SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, { auth: { persistSession: false } });

function deps(flags: AccountFlags = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true }) {
  const refunds: { account: string; pi: string; key: string }[] = [];
  const retrieved: string[] = [];
  const d: WebhookDeps = {
    db: paymentsDb(sb),
    constructEvent: (body, sig) => stripe.webhooks.constructEvent(body, sig, SECRET),
    refund: async (account, pi, key) => {
      refunds.push({ account, pi, key });
      return { id: `re_${refunds.length}` };
    },
    retrieveAccountFlags: async (id) => {
      retrieved.push(id);
      return flags;
    },
  };
  return { d, refunds, retrieved };
}

let owner: string;
let tenant: string;
let account: string;

beforeAll(async () => {
  const c = await pool.connect();
  try {
    owner = await createUser(c);
    tenant = await createTenant(c, owner);
    await applyConfig(c, tenant, owner, parse(presets.padel));
    account = `acct_wh${Date.now()}`;
    await c.query(`update public.tenants set published = true, stripe_account_id = $2, charges_enabled = true where id = $1`, [tenant, account]);
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await pool.query(`delete from public.stripe_events where event_id like 'evt_%'`);
  await pool.query(`delete from public.tenants where id = $1`, [tenant]);
  await pool.query(`delete from auth.users where id = $1`, [owner]);
  await pool.end();
});

async function hold(at: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`select public.create_booking_hold($1, 'court-60', $2::timestamptz, 'w@x.co', 'W') as id`, [tenant, at]);
  return r.rows[0]!.id;
}
const booking = (id: string) => pool.query(`select status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_refund_id from public.bookings where id = $1`, [id]).then((r) => r.rows[0]!);

describe("signature", () => {
  it("rejects missing or forged signatures without touching the database", async () => {
    const { d } = deps();
    const ev = checkoutEvent("checkout.session.completed", "00000000-0000-0000-0000-000000000000", account);
    expect(await handleStripeWebhook(JSON.stringify(ev), null, d)).toMatchObject({ status: 400 });
    expect(await handleStripeWebhook(JSON.stringify(ev), "t=1,v1=deadbeef", d)).toMatchObject({ status: 400 });
    const tampered = signed(ev);
    expect(await handleStripeWebhook(tampered.body.replace("booking_id", "booking_idx"), tampered.sig, d)).toMatchObject({ status: 400 });
    const seen = await pool.query(`select 1 from public.stripe_events where event_id = $1`, [ev.id]);
    expect(seen.rowCount).toBe(0);
  });
});

describe("checkout.session.completed", () => {
  it("confirms a pending hold and is idempotent on replay", async () => {
    const { d, refunds } = deps();
    const id = await hold("2026-11-10T10:00:00Z");
    const ev = checkoutEvent("checkout.session.completed", id, account, "pi_ok");
    const { body, sig } = signed(ev);

    const first = await handleStripeWebhook(body, sig, d);
    expect(first).toEqual({ status: 200, body: { received: true, action: `confirmed ${id}` } });
    expect(await booking(id)).toMatchObject({ status: "confirmed", stripe_payment_intent_id: "pi_ok", stripe_checkout_session_id: ev.data.object.id });

    const replay = await handleStripeWebhook(body, sig, d);
    expect(replay).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(refunds).toEqual([]);
  });

  it("refunds (incl. fee) when the hold was already lost, and marks the booking refunded", async () => {
    const { d, refunds } = deps();
    const id = await hold("2026-11-10T11:00:00Z");
    await pool.query(`select public.release_booking($1)`, [id]); // hold expired before payment landed
    const ev = checkoutEvent("checkout.session.completed", id, account, "pi_late");
    const { body, sig } = signed(ev);

    const r = await handleStripeWebhook(body, sig, d);
    expect(r).toEqual({ status: 200, body: { received: true, action: `refunded lost hold ${id}` } });
    expect(refunds).toEqual([{ account, pi: "pi_late", key: `refund-lost-hold-${id}` }]);
    expect(await booking(id)).toMatchObject({ status: "refunded", stripe_refund_id: "re_1", stripe_payment_intent_id: "pi_late" });

    // The slot is free again for someone else
    await hold("2026-11-10T11:00:00Z");
  });

  it("forgets the event and returns 500 when processing fails, so Stripe retries", async () => {
    const { d } = deps();
    const failing: WebhookDeps = { ...d, db: { ...d.db, confirmBooking: async () => Promise.reject(new Error("db down")) } };
    const id = await hold("2026-11-10T12:00:00Z");
    const ev = checkoutEvent("checkout.session.completed", id, account, "pi_retry");
    const { body, sig } = signed(ev);

    expect(await handleStripeWebhook(body, sig, failing)).toMatchObject({ status: 500 });
    const seen = await pool.query(`select 1 from public.stripe_events where event_id = $1`, [ev.id]);
    expect(seen.rowCount).toBe(0);

    // Retry with a healthy handler succeeds
    expect(await handleStripeWebhook(body, sig, d)).toMatchObject({ status: 200, body: { action: `confirmed ${id}` } });
  });
});

describe("checkout.session.expired / async_payment_failed", () => {
  it("releases the hold and frees allocations; a second event is a no-op", async () => {
    const { d } = deps();
    const id = await hold("2026-11-10T13:00:00Z");
    const { body, sig } = signed(checkoutEvent("checkout.session.expired", id, account, null));
    expect(await handleStripeWebhook(body, sig, d)).toMatchObject({ status: 200, body: { action: `released ${id}` } });
    expect(await booking(id)).toMatchObject({ status: "cancelled" });

    const again = signed(checkoutEvent("checkout.session.async_payment_failed", id, account, null));
    expect(await handleStripeWebhook(again.body, again.sig, d)).toMatchObject({ status: 200, body: { action: `already settled ${id}` } });
  });

  it("does not touch a booking that was already confirmed", async () => {
    const { d } = deps();
    const id = await hold("2026-11-10T14:00:00Z");
    const ok = signed(checkoutEvent("checkout.session.completed", id, account, "pi_first"));
    await handleStripeWebhook(ok.body, ok.sig, d);
    const exp = signed(checkoutEvent("checkout.session.expired", id, account, null));
    await handleStripeWebhook(exp.body, exp.sig, d);
    expect(await booking(id)).toMatchObject({ status: "confirmed" });
  });
});

describe("account.updated", () => {
  it("re-fetches the account and syncs charges/payouts/details flags", async () => {
    const { d, retrieved } = deps({ chargesEnabled: false, payoutsEnabled: true, detailsSubmitted: true });
    const ev = { ...checkoutEvent("account.updated", "", account), data: { object: { id: account, object: "account" } } };
    const { body, sig } = signed(ev);
    expect(await handleStripeWebhook(body, sig, d)).toMatchObject({ status: 200, body: { action: `synced ${account}` } });
    expect(retrieved).toEqual([account]);
    const t = await pool.query(`select charges_enabled, payouts_enabled, details_submitted from public.tenants where id = $1`, [tenant]);
    expect(t.rows[0]).toEqual({ charges_enabled: false, payouts_enabled: true, details_submitted: true });
    await pool.query(`update public.tenants set charges_enabled = true where id = $1`, [tenant]);
  });

  it("ignores accounts we do not know", async () => {
    const { d } = deps();
    const ev = { ...checkoutEvent("account.updated", "", "acct_nobody"), data: { object: { id: "acct_nobody", object: "account" } } };
    const { body, sig } = signed(ev);
    expect(await handleStripeWebhook(body, sig, d)).toMatchObject({ status: 200, body: { action: "unknown account acct_nobody" } });
  });
});

describe("unrelated events", () => {
  it("are recorded and ignored", async () => {
    const { d } = deps();
    const ev = { ...checkoutEvent("payment_intent.created", "", account), data: { object: { id: "pi_x", object: "payment_intent" } } };
    const { body, sig } = signed(ev);
    expect(await handleStripeWebhook(body, sig, d)).toMatchObject({ status: 200, body: { action: "ignored payment_intent.created" } });
  });
});
