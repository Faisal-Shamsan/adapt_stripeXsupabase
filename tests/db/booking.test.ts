import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { presets } from "@/engine/presets";
import type { TenantConfigInput } from "@/engine/schema";
import { applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

const NOW = "2026-10-30T08:00:00Z";

async function setup(c: PoolClient, cfg: TenantConfigInput) {
  const owner = await createUser(c);
  const tenant = await createTenant(c, owner);
  await applyConfig(c, tenant, owner, parse(cfg));
  const res = await c.query<{ key: string; id: string }>(`select key, id from public.resources where tenant_id = $1`, [tenant]);
  return { owner, tenant, byKey: Object.fromEntries(res.rows.map((r) => [r.key, r.id])) };
}

const hold = (c: PoolClient, tenant: string, service: string, at: string, prefs: string[] = [], opts: { email?: string; source?: string; step?: number; now?: string } = {}) =>
  c
    .query<{ id: string }>(`select public.create_booking_hold($1, $2, $3::timestamptz, $4, 'Test', null, $5::uuid[], $6, $7, $8::timestamptz) as id`, [
      tenant,
      service,
      at,
      opts.email ?? "t@example.com",
      prefs,
      opts.source ?? "online",
      opts.step ?? 15,
      opts.now ?? NOW,
    ])
    .then((r) => r.rows[0]!.id);

const bookingRow = (c: PoolClient, id: string) =>
  c
    .query(
      `select b.status, b.amount_cents, b.deposit_cents, b.currency, b.hold_expires_at, b.source, lower(b.during) as s, upper(b.during) as e,
              (select array_agg(r.key order by r.key) from public.booking_allocations a join public.resources r on r.id = a.resource_id where a.booking_id = b.id and a.active) as resources,
              (select upper(a.during) from public.booking_allocations a where a.booking_id = b.id limit 1) as alloc_end
       from public.bookings b where b.id = $1`,
      [id],
    )
    .then((r) => r.rows[0]!);

const anonymousGym: TenantConfigInput = {
  ...presets.gym,
  services: presets.gym.services.map((s) => (s.key === "spin-45" ? { ...s, capacity: 3, spotKind: null } : s)) as TenantConfigInput["services"],
  ui: { ...presets.gym.ui, resourcePicker: "list", sections: ["hero", "classes", "hours"], floorPlanImage: null },
};

describe("create_booking_hold", () => {
  it("creates a pending hold with server-side pricing and buffered allocations", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.salon); // 25% deposit
      const id = await hold(c, tenant, "cut", "2026-11-03T10:00:00Z", [byKey["amira"]!]);
      const b = await bookingRow(c, id);
      expect(b).toMatchObject({ status: "pending", amount_cents: 4200, deposit_cents: 1050, currency: "gbp", source: "online", resources: ["amira"] });
      expect(new Date(b.hold_expires_at).toISOString()).toBe("2026-10-30T08:31:00.000Z");
      expect(new Date(b.e).toISOString()).toBe("2026-11-03T10:45:00.000Z");
      expect(new Date(b.alloc_end).toISOString()).toBe("2026-11-03T10:55:00.000Z"); // +10 buffer
      const cust = await c.query(`select email, name from public.customers where tenant_id = $1`, [tenant]);
      expect(cust.rows).toEqual([{ email: "t@example.com", name: "Test" }]);
    }));

  it("walk-in bookings are confirmed immediately with no hold", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, presets.padel);
      const id = await hold(c, tenant, "court-60", "2026-11-03T10:00:00Z", [], { source: "walk_in" });
      expect(await bookingRow(c, id)).toMatchObject({ status: "confirmed", hold_expires_at: null, source: "walk_in", deposit_cents: 0, amount_cents: 3200 });
    }));

  it("auto-assigns deterministically and honours preferences", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.padel);
      const a = await hold(c, tenant, "court-60", "2026-11-03T10:00:00Z", [byKey["court-3"]!]);
      expect((await bookingRow(c, a)).resources).toEqual(["court-3"]);
      const b = await hold(c, tenant, "court-60", "2026-11-03T10:00:00Z");
      expect((await bookingRow(c, b)).resources).toHaveLength(1);
      expect((await bookingRow(c, b)).resources).not.toEqual(["court-3"]);
    }));

  it("combination allocates one resource per required kind, preferring the chosen therapist", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.spa);
      const fri = "2026-11-06T11:00:00Z";
      const a = await hold(c, tenant, "swedish-60", fri, [byKey["kai"]!]);
      const ra = (await bookingRow(c, a)).resources as string[];
      expect(ra).toContain("kai");
      expect(ra.filter((k) => k.startsWith("room"))).toHaveLength(1);
      const b = await hold(c, tenant, "swedish-60", fri);
      const rb = (await bookingRow(c, b)).resources as string[];
      expect(rb).toContain("lena");
      expect(rb.filter((k) => k.startsWith("room"))).toHaveLength(1);
      expect(rb).not.toContain(ra.find((k) => k.startsWith("room")));
      // Both therapists and both rooms are now busy
      expect((await pgError(c, () => hold(c, tenant, "swedish-60", fri))).code).toBe("AD002");
    }));

  it("rejects unavailable slots, bad preferences and off-grid times", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.salon);
      expect((await pgError(c, () => hold(c, tenant, "cut", "2026-11-02T10:00:00Z"))).code).toBe("AD002"); // Monday closed
      expect((await pgError(c, () => hold(c, tenant, "cut", "2026-11-03T10:07:00Z"))).code).toBe("AD002"); // off grid
      expect((await pgError(c, () => hold(c, tenant, "cut", "2026-11-03T10:00:00Z", [byKey["jules"]!]))).code).toBe("AD002"); // Jules off Tue
      expect((await pgError(c, () => hold(c, tenant, "colour", "2026-11-03T12:00:00Z", [byKey["amira"]!]))).code).toBe("AD002"); // overlaps lunch
      expect((await pgError(c, () => hold(c, tenant, "cut", "2026-11-03T10:00:00Z", [byKey["amira"]!, byKey["sam"]!]))).code).toBe("AD002"); // Sam can't cut
      expect((await pgError(c, () => hold(c, tenant, "cut", "2026-11-05T12:00:00Z", [byKey["amira"]!, byKey["jules"]!]))).code).toBe("22023"); // both eligible: too many prefs
      expect((await pgError(c, () => c.query(`select public.create_booking_hold($1, 'cut', '2026-11-03T10:00:00Z', 'not-an-email', 'X')`, [tenant]))).code).toBe("22023");
    }));
});

describe("book_class_spot", () => {
  async function firstSession(c: PoolClient, tenant: string, serviceKey: string) {
    const r = await c.query<{ id: string; capacity: number }>(
      `select id, capacity from public.class_sessions where tenant_id = $1 and service_key = $2 and active and starts_at > now() + interval '1 day' order by starts_at limit 1`,
      [tenant, serviceKey],
    );
    return r.rows[0]!;
  }

  it("spot class: allocates the bike, rejects double-booked and missing spots", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.gym);
      const s = await firstSession(c, tenant, "spin-45");
      const id = (await c.query<{ id: string }>(`select public.book_class_spot($1, $2, 'a@b.co', 'A', null, $3) as id`, [tenant, s.id, byKey["bike-1"]])).rows[0]!.id;
      expect(await bookingRow(c, id)).toMatchObject({ status: "pending", amount_cents: 1400, resources: ["bike-1"] });

      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'c@d.co', 'C', null, $3)`, [tenant, s.id, byKey["bike-1"]]))).code).toBe("23P01");
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'c@d.co', 'C', null, null)`, [tenant, s.id]))).code).toBe("AD003");
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'c@d.co', 'C', null, $3)`, [tenant, s.id, byKey["maya"]]))).code).toBe("AD003");
    }));

  it("anonymous class: capacity enforced, no spot accepted", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, anonymousGym);
      const s = await firstSession(c, tenant, "spin-45");
      expect(s.capacity).toBe(3);
      for (let i = 0; i < 3; i++) await c.query(`select public.book_class_spot($1, $2, $3, 'P')`, [tenant, s.id, `p${i}@x.co`]);
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'p9@x.co', 'P')`, [tenant, s.id]))).code).toBe("AD001");
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'p8@x.co', 'P', null, $3)`, [tenant, s.id, byKey["bike-1"]]))).code).toBe("AD003");
      // Releasing one hold frees a seat
      const one = await c.query<{ id: string }>(`select id from public.bookings where session_id = $1 limit 1`, [s.id]);
      await c.query(`select public.release_booking($1)`, [one.rows[0]!.id]);
      await c.query(`select public.book_class_spot($1, $2, 'p9@x.co', 'P')`, [tenant, s.id]);
    }));

  it("enforces minNotice and maxAdvance for sessions", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, presets.gym); // minNotice 30, maxAdvance 14
      const s = await firstSession(c, tenant, "spin-45");
      const starts = (await c.query<{ starts_at: Date }>(`select starts_at from public.class_sessions where id = $1`, [s.id])).rows[0]!.starts_at;
      const late = new Date(starts.getTime() - 10 * 60_000).toISOString();
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'a@b.co', 'A', null, null, 'online', $3::timestamptz)`, [tenant, s.id, late]))).code).toBe("AD002");
      const early = new Date(starts.getTime() - 20 * 86_400_000).toISOString();
      expect((await pgError(c, () => c.query(`select public.book_class_spot($1, $2, 'a@b.co', 'A', null, null, 'online', $3::timestamptz)`, [tenant, s.id, early]))).code).toBe("AD002");
    }));
});

describe("hold lifecycle", () => {
  it("expire_holds releases stale holds and frees the slot; confirm reports a lost hold", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, presets.padel);
      const at = "2026-11-03T10:00:00Z";
      const ids = await Promise.all([0, 1, 2, 3].map(() => hold(c, tenant, "court-60", at)));
      expect((await pgError(c, () => hold(c, tenant, "court-60", at))).code).toBe("AD002");

      const freedCourt = (await bookingRow(c, ids[0]!)).resources[0] as string;
      await c.query(`update public.bookings set hold_expires_at = $2 where id = $1`, [ids[0], "2026-10-30T07:00:00Z"]);
      const n = (await c.query<{ n: number }>(`select public.expire_holds($1::timestamptz) as n`, [NOW])).rows[0]!.n;
      expect(n).toBe(1);
      expect(await bookingRow(c, ids[0]!)).toMatchObject({ status: "cancelled", hold_expires_at: null, resources: null });

      // Exactly the freed court is bookable again; confirming the expired one reports the loss instead of resurrecting it
      const again = await hold(c, tenant, "court-60", at, [byKey[freedCourt]!]);
      expect((await bookingRow(c, again)).resources).toEqual([freedCourt]);
      const st = (await c.query<{ s: string }>(`select public.confirm_booking($1, 'pi_1', 'cs_1') as s`, [ids[0]])).rows[0]!.s;
      expect(st).toBe("cancelled");

      const ok = (await c.query<{ s: string }>(`select public.confirm_booking($1, 'pi_2', 'cs_2') as s`, [ids[1]])).rows[0]!.s;
      expect(ok).toBe("confirmed");
      expect(await bookingRow(c, ids[1]!)).toMatchObject({ status: "confirmed", hold_expires_at: null });
      expect((await c.query(`select public.expire_holds('2099-01-01'::timestamptz) as n`)).rows[0]!.n).toBe(3); // ids[2], ids[3] and `again`
    }));
});

describe("concurrency: 20 parallel requests", () => {
  async function committedTenant(cfg: TenantConfigInput) {
    const c = await pool.connect();
    try {
      const { owner, tenant, byKey } = await setup(c, cfg);
      return { owner, tenant, byKey };
    } finally {
      c.release();
    }
  }
  async function cleanup(tenant: string, owner: string) {
    await pool.query(`delete from public.tenants where id = $1`, [tenant]);
    await pool.query(`delete from auth.users where id = $1`, [owner]);
  }
  const fire = <T>(n: number, fn: (i: number) => Promise<T>) => Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const codes = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code as string);

  it("same slot, auto-assign across 4 courts: exactly 4 succeed", async () => {
    const { owner, tenant } = await committedTenant(presets.padel);
    try {
      const rs = await fire(20, (i) => hold(pool as unknown as PoolClient, tenant, "court-60", "2026-11-04T10:00:00Z", [], { email: `u${i}@x.co` }));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(4);
      for (const code of codes(rs)) expect(["AD002", "23P01"]).toContain(code);
      const alloc = await pool.query<{ n: number }>(`select count(*)::int as n from public.booking_allocations where tenant_id = $1 and active`, [tenant]);
      expect(alloc.rows[0]!.n).toBe(4);
    } finally {
      await cleanup(tenant, owner);
    }
  });

  it("same slot, same preferred court: exactly 1 succeeds", async () => {
    const { owner, tenant, byKey } = await committedTenant(presets.padel);
    try {
      const rs = await fire(20, (i) => hold(pool as unknown as PoolClient, tenant, "court-60", "2026-11-04T11:00:00Z", [byKey["court-2"]!], { email: `u${i}@x.co` }));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    } finally {
      await cleanup(tenant, owner);
    }
  });

  it("same bike in one class: exactly 1 succeeds", async () => {
    const { owner, tenant, byKey } = await committedTenant(presets.gym);
    try {
      const s = (await pool.query<{ id: string }>(`select id from public.class_sessions where tenant_id = $1 and active and starts_at > now() + interval '1 day' order by starts_at limit 1`, [tenant])).rows[0]!;
      const rs = await fire(20, (i) => pool.query(`select public.book_class_spot($1, $2, $3, 'U', null, $4)`, [tenant, s.id, `u${i}@x.co`, byKey["bike-5"]]));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const code of codes(rs)) expect(code).toBe("23P01");
    } finally {
      await cleanup(tenant, owner);
    }
  });

  it("anonymous class with capacity 3: exactly 3 succeed", async () => {
    const { owner, tenant } = await committedTenant(anonymousGym);
    try {
      const s = (await pool.query<{ id: string }>(`select id from public.class_sessions where tenant_id = $1 and service_key = 'spin-45' and active and starts_at > now() + interval '1 day' order by starts_at limit 1`, [tenant])).rows[0]!;
      const rs = await fire(20, (i) => pool.query(`select public.book_class_spot($1, $2, $3, 'U')`, [tenant, s.id, `u${i}@x.co`]));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      for (const code of codes(rs)) expect(code).toBe("AD001");
    } finally {
      await cleanup(tenant, owner);
    }
  });
});
