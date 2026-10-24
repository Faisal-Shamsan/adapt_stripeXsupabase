import { afterAll, describe, expect, it } from "vitest";
import { presets } from "@/engine/presets";
import { applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

describe("apply_config: versioning", () => {
  it("creates sequential versions and updates the tenant", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const cfg = parse(presets.padel);

      expect(await applyConfig(c, tenant, owner, cfg, "manual")).toBe(1);
      expect(await applyConfig(c, tenant, owner, cfg, "ai", "add a fifth court")).toBe(2);

      const t = await c.query(`select name, timezone, currency, config_version, config->'business'->>'name' as cfg_name from public.tenants where id = $1`, [tenant]);
      expect(t.rows[0]).toMatchObject({ name: "Harbourside Padel", timezone: "Europe/London", currency: "gbp", config_version: 2, cfg_name: "Harbourside Padel" });

      const v = await c.query(`select version, source, prompt from public.config_versions where tenant_id = $1 order by version`, [tenant]);
      expect(v.rows).toEqual([
        { version: 1, source: "manual", prompt: null },
        { version: 2, source: "ai", prompt: "add a fifth court" },
      ]);
    }));

  it("rejects non-owners with 42501 and leaves no trace", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const stranger = await createUser(c);
      const tenant = await createTenant(c, owner);
      const err = await pgError(c, () => applyConfig(c, tenant, stranger, parse(presets.padel)));
      expect(err.code).toBe("42501");
    }));

  it("rejects malformed config shape with 22023", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const err = await pgError(c, () => c.query(`select public.apply_config($1, $2, '{"version":1}'::jsonb, 'manual', null)`, [tenant, owner]));
      expect(err.code).toBe("22023");
    }));

  it("rejects an invalid source", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const err = await pgError(c, () => c.query(`select public.apply_config($1, $2, $3::jsonb, 'import', null)`, [tenant, owner, JSON.stringify(parse(presets.padel))]));
      expect(err.code).toBe("22023");
    }));
});

describe("apply_config: resource projection", () => {
  it("projects resources with kind, skills and positions", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.gym));

      const r = await c.query(`select key, kind, skills, position from public.resources where tenant_id = $1 and active order by key`, [tenant]);
      expect(r.rows).toHaveLength(14);
      expect(r.rows.find((x) => x.key === "maya")).toMatchObject({ kind: "staff", skills: ["spin-45", "spin-60"], position: null });
      expect(r.rows.find((x) => x.key === "bike-1")).toMatchObject({ kind: "bike", skills: [], position: { x: 0.15, y: 0.3 } });
    }));

  it("deactivates removed resources and reactivates them if they return", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const full = parse(presets.padel);
      await applyConfig(c, tenant, owner, full);

      const three = parse({ ...presets.padel, resources: presets.padel.resources.slice(0, 3) });
      await applyConfig(c, tenant, owner, three);

      const after = await c.query(`select key, active from public.resources where tenant_id = $1 order by key`, [tenant]);
      expect(after.rows).toEqual([
        { key: "court-1", active: true },
        { key: "court-2", active: true },
        { key: "court-3", active: true },
        { key: "court-4", active: false },
      ]);

      await applyConfig(c, tenant, owner, full);
      const back = await c.query(`select count(*)::int as n from public.resources where tenant_id = $1 and active`, [tenant]);
      expect(back.rows[0]!.n).toBe(4);
      const total = await c.query(`select count(*)::int as n from public.resources where tenant_id = $1`, [tenant]);
      expect(total.rows[0]!.n).toBe(4); // same row reactivated, not duplicated
    }));

  it("replaces resource hours and breaks", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.salon));

      const hours = await c.query(
        `select r.key, h.weekday, h.start_time::text as s, h.end_time::text as e
         from public.resource_hours h join public.resources r on r.id = h.resource_id
         where h.tenant_id = $1 order by r.key, h.weekday`,
        [tenant],
      );
      expect(hours.rows.filter((x) => x.key === "amira")).toHaveLength(4);
      expect(hours.rows.filter((x) => x.key === "jules")).toEqual([
        { key: "jules", weekday: 3, s: "12:00:00", e: "20:00:00" },
        { key: "jules", weekday: 4, s: "09:00:00", e: "18:00:00" },
        { key: "jules", weekday: 5, s: "09:00:00", e: "16:00:00" },
      ]);
      expect(hours.rows.filter((x) => x.key === "sam")).toHaveLength(0); // inherits business hours

      const breaks = await c.query(`select count(*)::int as n from public.resource_breaks where tenant_id = $1`, [tenant]);
      expect(breaks.rows[0]!.n).toBe(4);

      // Remove all per-resource schedules -> rows are gone
      await applyConfig(c, tenant, owner, parse({ ...presets.salon, schedules: { business: presets.salon.schedules.business } }));
      const gone = await c.query(`select count(*)::int as n from public.resource_hours where tenant_id = $1`, [tenant]);
      expect(gone.rows[0]!.n).toBe(0);
    }));
});

describe("apply_config: class session materialisation", () => {
  it("materialises 8 weeks of sessions with correct local times and instructors", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.gym));

      const s = await c.query<{ session_key: string; local: string; dow: number; instructor: string; capacity: number; spot_kind: string; mins: number }>(
        `select cs.session_key,
                to_char(cs.starts_at at time zone 'Europe/London', 'HH24:MI') as local,
                extract(isodow from cs.starts_at at time zone 'Europe/London')::int as dow,
                r.key as instructor, cs.capacity, cs.spot_kind,
                extract(epoch from (cs.ends_at - cs.starts_at))::int / 60 as mins
         from public.class_sessions cs join public.resources r on r.id = cs.instructor_id
         where cs.tenant_id = $1 and cs.active order by cs.starts_at`,
        [tenant],
      );
      // 4 weekly sessions x 8 weeks = 32
      expect(s.rows).toHaveLength(32);
      for (const row of s.rows.filter((r) => r.session_key === "mon-0700")) {
        expect(row).toMatchObject({ local: "07:00", dow: 1, instructor: "maya", capacity: 12, spot_kind: "bike", mins: 45 });
      }
      for (const row of s.rows.filter((r) => r.session_key === "mon-1830")) {
        expect(row).toMatchObject({ local: "18:30", dow: 1, instructor: "maya", capacity: 10, mins: 60 });
      }
      for (const row of s.rows.filter((r) => r.session_key === "sat-0900")) {
        expect(row).toMatchObject({ local: "09:00", dow: 6, instructor: "theo" });
      }
    }));

  it("keeps local wall-clock time across the DST change", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const cfg = parse(presets.gym);
      // Project a window straddling the 2026-03-29 spring-forward directly
      await c.query(`select public.project_class_sessions($1, $2::jsonb, '2026-03-23', '2026-04-06')`, [tenant, JSON.stringify(cfg)]);
      await c.query(`update public.resources set active = true where tenant_id = $1`, [tenant]); // no-op guard
      const s = await c.query<{ utc: string; local: string }>(
        `select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc,
                to_char(starts_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') as local
         from public.class_sessions where tenant_id = $1 and session_key = 'mon-0700' order by starts_at`,
        [tenant],
      );
      expect(s.rows).toEqual([
        { utc: "2026-03-23 07:00", local: "2026-03-23 07:00" }, // GMT
        { utc: "2026-03-30 06:00", local: "2026-03-30 07:00" }, // BST: UTC shifts, local does not
      ]);
    }));

  it("deactivates future sessions removed from config and never deletes rows", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.gym));

      const without = parse({
        ...presets.gym,
        schedules: { ...presets.gym.schedules, classSessions: presets.gym.schedules.classSessions!.filter((s) => s.key !== "wed-0700") },
      });
      await applyConfig(c, tenant, owner, without);

      const counts = await c.query<{ session_key: string; active: boolean; n: number }>(
        `select session_key, active, count(*)::int as n from public.class_sessions where tenant_id = $1 group by 1, 2 order by 1, 2`,
        [tenant],
      );
      expect(counts.rows).toEqual([
        { session_key: "mon-0700", active: true, n: 8 },
        { session_key: "mon-1830", active: true, n: 8 },
        { session_key: "sat-0900", active: true, n: 8 },
        { session_key: "wed-0700", active: false, n: 8 },
      ]);
    }));

  it("moving a session's time deactivates the old occurrences and creates new ones", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.gym));

      const moved = parse({
        ...presets.gym,
        schedules: {
          ...presets.gym.schedules,
          classSessions: presets.gym.schedules.classSessions!.map((s) => (s.key === "mon-0700" ? { ...s, start: "07:30" } : s)),
        },
      });
      await applyConfig(c, tenant, owner, moved);

      const s = await c.query<{ local: string; active: boolean; n: number }>(
        `select to_char(starts_at at time zone 'Europe/London', 'HH24:MI') as local, active, count(*)::int as n
         from public.class_sessions where tenant_id = $1 and session_key = 'mon-0700' group by 1, 2 order by 1`,
        [tenant],
      );
      expect(s.rows).toEqual([
        { local: "07:00", active: false, n: 8 },
        { local: "07:30", active: true, n: 8 },
      ]);
    }));

  it("extend_class_sessions is idempotent", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      await applyConfig(c, tenant, owner, parse(presets.gym));
      const before = await c.query(`select count(*)::int as n from public.class_sessions where tenant_id = $1`, [tenant]);
      await c.query(`select public.extend_class_sessions()`);
      await c.query(`select public.extend_class_sessions()`);
      const after = await c.query(`select count(*)::int as n from public.class_sessions where tenant_id = $1`, [tenant]);
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    }));
});
