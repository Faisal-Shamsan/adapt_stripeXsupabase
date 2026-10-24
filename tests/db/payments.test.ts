import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { presets } from "@/engine/presets";
import { applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

const NOW = "2026-10-30T08:00:00Z";

async function setup(c: PoolClient, cfg = presets.padel) {
  const owner = await createUser(c);
  const tenant = await createTenant(c, owner);
  await applyConfig(c, tenant, owner, parse(cfg));
  await c.query(`update public.tenants set published = true, stripe_account_id = $2, charges_enabled = true where id = $1`, [tenant, `acct_${tenant.replace(/-/g, "").slice(0, 16)}`]);
  return { owner, tenant };
}

async function holdWithToken(c: PoolClient, tenant: string, service = "court-60", at = "2026-11-03T10:00:00Z") {
  const id = (await c.query<{ id: string }>(`select public.create_booking_hold($1, $2, $3::timestamptz, 'c@x.co', 'C', null, '{}', 'online', 15, $4::timestamptz) as id`, [tenant, service, at, NOW])).rows[0]!.id;
  const token = (await c.query<{ manage_token: string }>(`select manage_token from public.bookings where id = $1`, [id])).rows[0]!.manage_token;
  return { id, token };
}

describe("stripe_events idempotency", () => {
  it("first record is true, replay is false, forget allows reprocessing", () =>
    withTx(async (c) => {
      const r = (q: string) => c.query<{ r: boolean }>(`select public.${q} as r`).then((x) => x.rows[0]!.r);
      expect(await r(`record_stripe_event('evt_1', 'checkout.session.completed')`)).toBe(true);
      expect(await r(`record_stripe_event('evt_1', 'checkout.session.completed')`)).toBe(false);
      await c.query(`select public.forget_stripe_event('evt_1')`);
      expect(await r(`record_stripe_event('evt_1', 'checkout.session.completed')`)).toBe(true);
    }));
});

describe("connected account lifecycle", () => {
  it("attach requires ownership, refuses overwrite; sync updates flags by account id", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const stranger = await createUser(c);
      const tenant = await createTenant(c, owner);
      expect((await pgError(c, () => c.query(`select public.attach_stripe_account($1, $2, 'acct_abc')`, [tenant, stranger]))).code).toBe("42501");
      expect((await pgError(c, () => c.query(`select public.attach_stripe_account($1, $2, 'not-an-account')`, [tenant, owner]))).code).toBe("22023");
      await c.query(`select public.attach_stripe_account($1, $2, 'acct_abc')`, [tenant, owner]);
      expect((await pgError(c, () => c.query(`select public.attach_stripe_account($1, $2, 'acct_other')`, [tenant, owner]))).code).toBe("23505");

      const synced = (await c.query<{ t: string | null }>(`select public.sync_stripe_account('acct_abc', true, false, true) as t`)).rows[0]!.t;
      expect(synced).toBe(tenant);
      const t = await c.query(`select charges_enabled, payouts_enabled, details_submitted from public.tenants where id = $1`, [tenant]);
      expect(t.rows[0]).toEqual({ charges_enabled: true, payouts_enabled: false, details_submitted: true });
      expect((await c.query<{ t: string | null }>(`select public.sync_stripe_account('acct_unknown', true, true, true) as t`)).rows[0]!.t).toBeNull();
    }));
});

describe("begin_checkout", () => {
  it("validates token, extends the hold, returns server-side amounts", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, presets.salon); // 25% deposit on cut (4200 -> 1050)
      const { id, token } = await holdWithToken(c, tenant, "cut", "2026-11-03T10:00:00Z");
      expect((await pgError(c, () => c.query(`select * from public.begin_checkout($1, 'wrong-token')`, [id]))).code).toBe("P0002");

      const later = "2026-10-30T08:20:00Z";
      const r = (await c.query(`select * from public.begin_checkout($1, $2, $3::timestamptz)`, [id, token, later])).rows[0]!;
      expect(r).toMatchObject({ tenant_id: tenant, currency: "gbp", due_now_cents: 1050, customer_email: "c@x.co", charges_enabled: true });
      expect(r.description).toMatch(/^Cut & finish — /);
      expect(new Date(r.expires_at).toISOString()).toBe("2026-10-30T08:51:00.000Z");
      const b = await c.query(`select hold_expires_at from public.bookings where id = $1`, [id]);
      expect(new Date(b.rows[0]!.hold_expires_at).toISOString()).toBe("2026-10-30T08:51:00.000Z");

      await c.query(`select public.set_checkout_session($1, 'cs_test_1')`, [id]);
      expect((await c.query(`select stripe_checkout_session_id from public.bookings where id = $1`, [id])).rows[0]!.stripe_checkout_session_id).toBe("cs_test_1");
    }));

  it("full-payment tenants charge the whole amount; refuses non-pending, walk-in, and unpayable tenants", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c);
      const { id, token } = await holdWithToken(c, tenant);
      const r = (await c.query(`select due_now_cents from public.begin_checkout($1, $2)`, [id, token])).rows[0]!;
      expect(r.due_now_cents).toBe(3200);

      await c.query(`select public.release_booking($1)`, [id]);
      expect((await pgError(c, () => c.query(`select * from public.begin_checkout($1, $2)`, [id, token]))).code).toBe("AD004");

      const walkIn = (await c.query<{ id: string }>(`select public.create_booking_hold($1, 'court-60', '2026-11-03T12:00:00Z', 'w@x.co', 'W', null, '{}', 'walk_in', 15, $2::timestamptz) as id`, [tenant, NOW])).rows[0]!.id;
      const wt = (await c.query(`select manage_token from public.bookings where id = $1`, [walkIn])).rows[0]!.manage_token;
      expect((await pgError(c, () => c.query(`select * from public.begin_checkout($1, $2)`, [walkIn, wt]))).code).toBe("AD004");

      await c.query(`update public.tenants set charges_enabled = false where id = $1`, [tenant]);
      const h2 = await holdWithToken(c, tenant, "court-60", "2026-11-03T14:00:00Z");
      expect((await pgError(c, () => c.query(`select * from public.begin_checkout($1, $2)`, [h2.id, h2.token]))).code).toBe("AD005");
    }));
});

describe("cancel_booking", () => {
  const confirm = (c: PoolClient, id: string) => c.query(`select public.confirm_booking($1::uuid, $2, $3)`, [id, `pi_${id}`, `cs_${id}`]);

  it("customer: pending hold is released without refund", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c);
      const { id, token } = await holdWithToken(c, tenant);
      const r = (await c.query(`select * from public.cancel_booking($1, $2, null, $3::timestamptz)`, [id, token, NOW])).rows[0]!;
      expect(r).toMatchObject({ refund: false, status: "cancelled" });
      const alloc = await c.query(`select count(*)::int as n from public.booking_allocations where booking_id = $1 and active`, [id]);
      expect(alloc.rows[0]!.n).toBe(0);
    }));

  it("customer: confirmed inside the deadline refunds, after the deadline does not", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c); // padel: 24h deadline; booking 2026-11-03T10:00Z
      const a = await holdWithToken(c, tenant, "court-60", "2026-11-03T10:00:00Z");
      await confirm(c, a.id);
      const early = (await c.query(`select * from public.cancel_booking($1, $2, null, '2026-11-02T09:59:00Z')`, [a.id, a.token])).rows[0]!;
      expect(early).toMatchObject({ refund: true, payment_intent: `pi_${a.id}` });
      expect(early.stripe_account_id).toMatch(/^acct_/);

      const b = await holdWithToken(c, tenant, "court-60", "2026-11-03T11:00:00Z");
      await confirm(c, b.id);
      const late = (await c.query(`select * from public.cancel_booking($1, $2, null, '2026-11-02T11:01:00Z')`, [b.id, b.token])).rows[0]!;
      expect(late).toMatchObject({ refund: false, status: "cancelled" });

      // mark_refunded finalises the refunded one and is the only path to 'refunded'
      await c.query(`select public.mark_refunded($1, 're_1')`, [a.id]);
      const st = await c.query(`select status, stripe_refund_id from public.bookings where id = $1`, [a.id]);
      expect(st.rows[0]).toEqual({ status: "refunded", stripe_refund_id: "re_1" });
    }));

  it("authorisation: wrong token and strangers are refused; owner may always cancel with refund", () =>
    withTx(async (c) => {
      const { tenant, owner } = await setup(c);
      const stranger = await createUser(c);
      const { id, token } = await holdWithToken(c, tenant);
      await confirm(c, id);
      expect((await pgError(c, () => c.query(`select * from public.cancel_booking($1, 'nope', null)`, [id]))).code).toBe("42501");
      expect((await pgError(c, () => c.query(`select * from public.cancel_booking($1, null, $2)`, [id, stranger]))).code).toBe("42501");
      expect((await pgError(c, () => c.query(`select * from public.cancel_booking($1, null, null)`, [id]))).code).toBe("42501");
      // Owner cancels 1h before start: customer would get nothing, owner-initiated refunds anyway
      const r = (await c.query(`select * from public.cancel_booking($1, null, $2, '2026-11-03T09:00:00Z')`, [id, owner])).rows[0]!;
      expect(r.refund).toBe(true);
      expect((await pgError(c, () => c.query(`select * from public.cancel_booking($1, $2, null)`, [id, token]))).code).toBe("AD004");
    }));

  it("customer cannot cancel after the booking has started", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c);
      const { id, token } = await holdWithToken(c, tenant);
      await confirm(c, id);
      expect((await pgError(c, () => c.query(`select * from public.cancel_booking($1, $2, null, '2026-11-03T10:30:00Z')`, [id, token]))).code).toBe("AD004");
    }));
});

describe("booking_by_token", () => {
  it("returns the customer view only with the right token", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c);
      const { id, token } = await holdWithToken(c, tenant);
      const r = await c.query(`select * from public.booking_by_token($1, $2)`, [id, token]);
      expect(r.rows[0]).toMatchObject({ id, tenant_name: "Harbourside Padel", service_key: "court-60", status: "pending", amount_cents: 3200, customer_email: "c@x.co", cancellation_deadline_hours: 24 });
      expect(r.rows[0]!.resources).toHaveLength(1);
      expect((await c.query(`select * from public.booking_by_token($1, 'bad')`, [id])).rows).toEqual([]);
    }));
});
