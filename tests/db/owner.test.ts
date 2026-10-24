import { afterAll, describe, expect, it } from "vitest";
import { presets } from "@/engine/presets";
import { applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

describe("create_tenant", () => {
  it("slugifies the name, de-duplicates, and rejects unknown owners / empty names", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const a = (await c.query(`select * from public.create_tenant($1, 'Fringe & Co.')`, [owner])).rows[0]!;
      expect(a.slug).toBe("fringe-co");
      const b = (await c.query(`select * from public.create_tenant($1, 'Fringe & Co')`, [owner])).rows[0]!;
      expect(b.slug).toBe("fringe-co-1");
      const t = await c.query(`select name, published, config from public.tenants where id = $1`, [a.id]);
      expect(t.rows[0]).toEqual({ name: "Fringe & Co.", published: false, config: null });
      expect((await pgError(c, () => c.query(`select * from public.create_tenant('00000000-0000-0000-0000-000000000000', 'x')`))).code).toBe("42501");
      expect((await pgError(c, () => c.query(`select * from public.create_tenant($1, '   ')`, [owner]))).code).toBe("22023");
    }));
});

describe("set_published", () => {
  it("refuses to publish without a config; owner only", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const stranger = await createUser(c);
      const tenant = await createTenant(c, owner);
      expect((await pgError(c, () => c.query(`select public.set_published($1, $2, true)`, [tenant, owner]))).code).toBe("AD004");
      await applyConfig(c, tenant, owner, parse(presets.padel));
      expect((await pgError(c, () => c.query(`select public.set_published($1, $2, true)`, [tenant, stranger]))).code).toBe("42501");
      await c.query(`select public.set_published($1, $2, true)`, [tenant, owner]);
      expect((await c.query(`select published from public.tenants where id = $1`, [tenant])).rows[0]!.published).toBe(true);
    }));
});

describe("rollback_config", () => {
  it("re-applies an older version as a new version and re-projects", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.padel)); // v1: 4 courts
      await applyConfig(c, tenant, owner, parse({ ...presets.padel, resources: presets.padel.resources.slice(0, 2) })); // v2: 2 courts
      const v3 = (await c.query<{ v: number }>(`select public.rollback_config($1, $2, 1) as v`, [tenant, owner])).rows[0]!.v;
      expect(v3).toBe(3);
      const vers = await c.query(`select version, source, prompt from public.config_versions where tenant_id = $1 order by version`, [tenant]);
      expect(vers.rows[2]).toEqual({ version: 3, source: "rollback", prompt: "rollback to v1" });
      const active = await c.query(`select count(*)::int as n from public.resources where tenant_id = $1 and active`, [tenant]);
      expect(active.rows[0]!.n).toBe(4);
      expect((await pgError(c, () => c.query(`select public.rollback_config($1, $2, 99)`, [tenant, owner]))).code).toBe("P0002");
    }));
});

describe("owner_bookings", () => {
  it("lists bookings with labels for the owner only", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const stranger = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.padel));
      await c.query(`select public.create_booking_hold($1, 'court-60', '2026-11-03T10:00:00Z', 'a@b.co', 'Ann', null, '{}', 'walk_in', 15, '2026-10-30T08:00:00Z')`, [tenant]);
      const r = await c.query(`select * from public.owner_bookings($1, $2, '2026-10-01')`, [tenant, owner]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ service_key: "court-60", status: "confirmed", source: "walk_in", customer_name: "Ann", amount_cents: 3200 });
      expect(r.rows[0]!.resources).toHaveLength(1);
      expect((await pgError(c, () => c.query(`select * from public.owner_bookings($1, $2)`, [tenant, stranger]))).code).toBe("42501");
    }));
});
