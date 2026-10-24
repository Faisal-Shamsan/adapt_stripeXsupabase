import { afterAll, describe, expect, it } from "vitest";
import { presets } from "@/engine/presets";
import { actAs, actAsService, applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

const TABLES = [
  "tenants",
  "config_versions",
  "chat_messages",
  "ai_rate_limits",
  "resources",
  "resource_hours",
  "resource_breaks",
  "time_off",
  "class_sessions",
  "customers",
  "bookings",
  "booking_allocations",
  "stripe_events",
];

describe("RLS coverage", () => {
  it("every public table has RLS enabled", () =>
    withTx(async (c) => {
      const r = await c.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by relname`,
      );
      expect(r.rows.map((x) => x.relname).sort()).toEqual([...TABLES].sort());
      for (const row of r.rows) expect(row.relrowsecurity, `${row.relname} lacks RLS`).toBe(true);
    }));

  it("no table grants insert/update/delete policies to anon or authenticated", () =>
    withTx(async (c) => {
      const r = await c.query<{ tablename: string; cmd: string }>(
        `select tablename, cmd from pg_policies where schemaname = 'public' and cmd <> 'SELECT'`,
      );
      expect(r.rows).toEqual([]);
    }));
});

describe("RLS: owner isolation", () => {
  it("owner sees own tenant data; another owner sees nothing; anon sees nothing", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const b = await createUser(c);
      const ta = await createTenant(c, a);
      const tb = await createTenant(c, b);
      await applyConfig(c, ta, a, parse(presets.gym));
      await applyConfig(c, tb, b, parse(presets.salon));

      await actAs(c, "authenticated", a);
      const tenants = await c.query(`select id from public.tenants`);
      expect(tenants.rows.map((x) => x.id)).toEqual([ta]);
      const res = await c.query(`select distinct tenant_id from public.resources`);
      expect(res.rows.map((x) => x.tenant_id)).toEqual([ta]);
      const sessions = await c.query(`select count(*)::int as n from public.class_sessions`);
      expect(sessions.rows[0]!.n).toBe(32);
      const versions = await c.query(`select count(*)::int as n from public.config_versions`);
      expect(versions.rows[0]!.n).toBe(1);

      await actAsService(c);
      await actAs(c, "authenticated", b);
      const bres = await c.query(`select distinct tenant_id from public.resources`);
      expect(bres.rows.map((x) => x.tenant_id)).toEqual([tb]);
      const bsessions = await c.query(`select count(*)::int as n from public.class_sessions`);
      expect(bsessions.rows[0]!.n).toBe(0);

      await actAsService(c);
      await actAs(c, "anon");
      for (const t of ["tenants", "resources", "class_sessions", "config_versions", "bookings"]) {
        const r = await c.query(`select count(*)::int as n from public.${t}`);
        expect(r.rows[0]!.n, t).toBe(0);
      }
    }));

  it("authenticated users cannot write directly to any table", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const ta = await createTenant(c, a);
      await applyConfig(c, ta, a, parse(presets.padel));

      await actAs(c, "authenticated", a);
      const ins = await pgError(c, () => c.query(`insert into public.resources (tenant_id, key, kind, label) values ($1, 'court-9', 'court', 'x')`, [ta]));
      expect(ins.code).toBe("42501");
      // UPDATE/DELETE with no policy: Postgres filters rows silently (0 rows) rather than erroring.
      const upd = await c.query(`update public.tenants set name = 'hacked' where id = $1`, [ta]);
      expect(upd.rowCount).toBe(0);
      const del = await c.query(`delete from public.resources where tenant_id = $1`, [ta]);
      expect(del.rowCount).toBe(0);
      await actAsService(c);
      const t = await c.query(`select name from public.tenants where id = $1`, [ta]);
      expect(t.rows[0]!.name).toBe("Harbourside Padel");
    }));

  it("service-only tables are invisible to authenticated users", () =>
    withTx(async (c) => {
      await c.query(`insert into public.stripe_events (event_id, type) values ('evt_test', 'x')`);
      const a = await createUser(c);
      await actAs(c, "authenticated", a);
      const r = await c.query(`select count(*)::int as n from public.stripe_events`);
      expect(r.rows[0]!.n).toBe(0);
    }));
});

describe("RLS: privileged functions are revoked", () => {
  it("authenticated cannot call apply_config even for their own tenant", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const ta = await createTenant(c, a);
      await actAs(c, "authenticated", a);
      const err = await pgError(c, () => c.query(`select public.apply_config($1, $2, $3::jsonb, 'manual', null)`, [ta, a, JSON.stringify(parse(presets.padel))]));
      expect(err.code).toBe("42501");
    }));

  it("anon cannot call project_class_sessions or extend_class_sessions", () =>
    withTx(async (c) => {
      await actAs(c, "anon");
      expect((await pgError(c, () => c.query(`select public.extend_class_sessions()`))).code).toBe("42501");
      expect((await pgError(c, () => c.query(`select public.project_class_sessions(gen_random_uuid(), '{}'::jsonb, current_date, current_date)`))).code).toBe("42501");
    }));
});

describe("tenant isolation at the FK level", () => {
  it("rejects a resource_hours row pointing at another tenant's resource", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const b = await createUser(c);
      const ta = await createTenant(c, a);
      const tb = await createTenant(c, b);
      await applyConfig(c, ta, a, parse(presets.padel));
      const court = await c.query<{ id: string }>(`select id from public.resources where tenant_id = $1 limit 1`, [ta]);
      const err = await pgError(c, () =>
        c.query(`insert into public.resource_hours (tenant_id, resource_id, weekday, start_time, end_time) values ($1, $2, 0, '09:00', '10:00')`, [tb, court.rows[0]!.id]),
      );
      expect(err.code).toBe("23503");
    }));

  it("rejects a class session with an instructor from another tenant", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const b = await createUser(c);
      const ta = await createTenant(c, a);
      const tb = await createTenant(c, b);
      await applyConfig(c, ta, a, parse(presets.gym));
      const maya = await c.query<{ id: string }>(`select id from public.resources where tenant_id = $1 and key = 'maya'`, [ta]);
      const err = await pgError(c, () =>
        c.query(
          `insert into public.class_sessions (tenant_id, session_key, service_key, instructor_id, starts_at, ends_at, capacity)
           values ($1, 'x', 'spin-45', $2, now(), now() + interval '45 min', 10)`,
          [tb, maya.rows[0]!.id],
        ),
      );
      expect(err.code).toBe("23503");
    }));

  it("rejects a booking whose customer belongs to another tenant", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const b = await createUser(c);
      const ta = await createTenant(c, a);
      const tb = await createTenant(c, b);
      const cust = await c.query<{ id: string }>(`insert into public.customers (tenant_id, email, name) values ($1, 'x@y.z', 'X') returning id`, [ta]);
      const err = await pgError(c, () =>
        c.query(
          `insert into public.bookings (tenant_id, customer_id, service_key, during, amount_cents, currency, hold_expires_at)
           values ($1, $2, 'cut', tstzrange(now(), now() + interval '1 hour'), 1000, 'gbp', now() + interval '31 min')`,
          [tb, cust.rows[0]!.id],
        ),
      );
      expect(err.code).toBe("23503");
    }));

  it("rejects an allocation whose resource belongs to another tenant", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const b = await createUser(c);
      const ta = await createTenant(c, a);
      const tb = await createTenant(c, b);
      await applyConfig(c, ta, a, parse(presets.padel));
      await applyConfig(c, tb, b, parse(presets.padel));
      const court = await c.query<{ id: string }>(`select id from public.resources where tenant_id = $1 limit 1`, [ta]);
      const cust = await c.query<{ id: string }>(`insert into public.customers (tenant_id, email, name) values ($1, 'x@y.z', 'X') returning id`, [tb]);
      const booking = await c.query<{ id: string }>(
        `insert into public.bookings (tenant_id, customer_id, service_key, during, amount_cents, currency, hold_expires_at)
         values ($1, $2, 'court-60', tstzrange(now(), now() + interval '1 hour'), 3200, 'gbp', now() + interval '31 min') returning id`,
        [tb, cust.rows[0]!.id],
      );
      const err = await pgError(c, () =>
        c.query(`insert into public.booking_allocations (booking_id, tenant_id, resource_id, during) values ($1, $2, $3, tstzrange(now(), now() + interval '1 hour'))`, [
          booking.rows[0]!.id,
          tb,
          court.rows[0]!.id,
        ]),
      );
      expect(err.code).toBe("23503");
    }));
});

describe("booking_allocations exclusion constraint", () => {
  it("rejects overlapping active allocations on one resource, allows adjacent and inactive", () =>
    withTx(async (c) => {
      const a = await createUser(c);
      const ta = await createTenant(c, a);
      await applyConfig(c, ta, a, parse(presets.padel));
      const court = (await c.query<{ id: string }>(`select id from public.resources where tenant_id = $1 and key = 'court-1'`, [ta])).rows[0]!.id;
      const cust = (await c.query<{ id: string }>(`insert into public.customers (tenant_id, email, name) values ($1, 'x@y.z', 'X') returning id`, [ta])).rows[0]!.id;
      const mk = async (from: string, to: string) =>
        (
          await c.query<{ id: string }>(
            `insert into public.bookings (tenant_id, customer_id, service_key, during, amount_cents, currency, hold_expires_at)
             values ($1, $2, 'court-60', tstzrange($3, $4), 3200, 'gbp', now() + interval '31 min') returning id`,
            [ta, cust, from, to],
          )
        ).rows[0]!.id;
      const alloc = (booking: string, from: string, to: string, active = true) =>
        c.query(`insert into public.booking_allocations (booking_id, tenant_id, resource_id, during, active) values ($1, $2, $3, tstzrange($4, $5), $6)`, [
          booking,
          ta,
          court,
          from,
          to,
          active,
        ]);

      const b1 = await mk("2026-11-02T10:00Z", "2026-11-02T11:00Z");
      await alloc(b1, "2026-11-02T10:00Z", "2026-11-02T11:00Z");

      const b2 = await mk("2026-11-02T10:30Z", "2026-11-02T11:30Z");
      const err = await pgError(c, () => alloc(b2, "2026-11-02T10:30Z", "2026-11-02T11:30Z"));
      expect(err.code).toBe("23P01");

      // Inactive overlapping allocation is fine (released hold)
      await alloc(b2, "2026-11-02T10:30Z", "2026-11-02T11:30Z", false);

      // Adjacent [11:00, 12:00) does not overlap [10:00, 11:00)
      const b3 = await mk("2026-11-02T11:00Z", "2026-11-02T12:00Z");
      await alloc(b3, "2026-11-02T11:00Z", "2026-11-02T12:00Z");
    }));
});
