import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { presets } from "@/engine/presets";
import { applyConfig, createTenant, createUser, parse, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

type Slot = { starts_at: Date; ends_at: Date; candidates: Record<string, string[]> };

async function slots(c: PoolClient, tenant: string, service: string, date: string, now: string, step = 15): Promise<Slot[]> {
  const r = await c.query<Slot>(`select * from public.available_slots($1, $2, $3::date, $4, $5::timestamptz)`, [tenant, service, date, step, now]);
  return r.rows;
}
const local = (d: Date, tz = "Europe/London") =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const locals = (s: Slot[]) => s.map((x) => local(x.starts_at));
const utc = (d: Date) => d.toISOString().slice(11, 16);

async function setup(c: PoolClient, preset: keyof typeof presets) {
  const owner = await createUser(c);
  const tenant = await createTenant(c, owner);
  await applyConfig(c, tenant, owner, parse(presets[preset]));
  const res = await c.query<{ key: string; id: string }>(`select key, id from public.resources where tenant_id = $1`, [tenant]);
  return { owner, tenant, byKey: Object.fromEntries(res.rows.map((r) => [r.key, r.id])) };
}

// Salon: Tue-Sat; Tue 09:00-18:00. Amira (cut, colour) Tue-Fri 09-18 w/ lunch 13:00-13:30;
// Jules (cut, beard) Thu 12-20 / Fri / Sat; Sam (beard) has no hours rows and inherits business hours.
// 2026-10-27 is a Tuesday after the autumn DST change (GMT = UTC).
const TUE = "2026-10-27";
const EARLY = "2026-10-20T08:00:00Z";

describe("available_slots: the five gates", () => {
  it("closed day returns nothing", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "salon");
      expect(await slots(c, tenant, "cut", "2026-10-26", EARLY)).toEqual([]); // Monday
      expect(await slots(c, tenant, "cut", "2026-11-01", EARLY)).toEqual([]); // Sunday
    }));

  it("slots fit entirely inside business hours", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "salon");
      const s = await slots(c, tenant, "cut", TUE, EARLY);
      expect(locals(s)[0]).toBe("09:00");
      expect(locals(s).at(-1)).toBe("17:15"); // 17:15 + 45 = 18:00; 17:30 would overrun
    }));

  it("respects minNotice (salon: 120 min)", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "salon");
      const s = await slots(c, tenant, "cut", TUE, "2026-10-27T09:10:00Z");
      expect(locals(s)[0]).toBe("11:15"); // first step >= 11:10
    }));

  it("respects maxAdvance (salon: 60 days)", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "salon");
      // 2026-12-26 Sat is 60 days after 2026-10-27 => allowed; 2027-01-02 Sat is 67 => not
      expect((await slots(c, tenant, "cut", "2026-12-26", "2026-10-27T08:00:00Z")).length).toBeGreaterThan(0);
      expect(await slots(c, tenant, "cut", "2027-01-02", "2026-10-27T08:00:00Z")).toEqual([]);
    }));

  it("nothing in the past", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "salon");
      expect(await slots(c, tenant, "cut", TUE, "2026-10-27T17:00:00Z")).toEqual([]); // closes 18:00, notice 120
      expect(await slots(c, tenant, "cut", "2026-10-13", EARLY)).toEqual([]); // a week ago
    }));
});

describe("available_slots: resources", () => {
  it("staff must be skilled; unskilled staff never appear", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "salon");
      const beard = await slots(c, tenant, "beard", TUE, EARLY);
      // Jules does not work Tuesday, so only Sam
      expect(beard[0]!.candidates["staff"]).toEqual([byKey["sam"]]);
      const colour = await slots(c, tenant, "colour", TUE, EARLY);
      expect(colour[0]!.candidates["staff"]).toEqual([byKey["amira"]]);
    }));

  it("resources without hours rows inherit business hours; explicit hours restrict", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "salon");
      // Thursday 09:00-20:00; beard: Jules explicit 12-20, Sam inherits 09-20
      const thu = await slots(c, tenant, "beard", "2026-10-29", EARLY);
      const at = (hhmm: string) => thu.find((s) => local(s.starts_at) === hhmm)!.candidates["staff"]!.sort();
      expect(at("09:00")).toEqual([byKey["sam"]]);
      expect(at("12:00")).toEqual([byKey["jules"], byKey["sam"]].sort());
      expect(at("19:30")).toEqual([byKey["jules"], byKey["sam"]].sort());
      // cut: Amira 09-18 explicit, Jules from 12:00
      const cut = await slots(c, tenant, "cut", "2026-10-29", EARLY);
      const cat = (hhmm: string) => cut.find((s) => local(s.starts_at) === hhmm)!.candidates["staff"]!.sort();
      expect(cat("09:00")).toEqual([byKey["amira"]]);
      expect(cat("12:00")).toEqual([byKey["amira"], byKey["jules"]].sort());
      expect(cat("19:00")).toEqual([byKey["jules"]]);
    }));

  it("breaks exclude a resource when the service overlaps the break", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "salon");
      // Tuesday cut is Amira-only, so the break removes whole slots
      const cut = locals(await slots(c, tenant, "cut", TUE, EARLY));
      expect(cut).toContain("12:15"); // ends 13:00, touches but no overlap
      expect(cut).not.toContain("12:30"); // ends 13:15, overlaps lunch
      expect(cut).not.toContain("13:15"); // starts inside lunch
      expect(cut).toContain("13:30");
      void byKey;
      // colour (120 min) is Amira-only: 09:00..11:00 before lunch, 13:30..16:00 after
      const colour = locals(await slots(c, tenant, "colour", TUE, EARLY));
      expect(colour).toHaveLength(9 + 11);
      expect(colour).toContain("11:00");
      expect(colour).not.toContain("11:15");
      expect(colour).toContain("13:30");
    }));

  it("time off removes a resource", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "salon");
      await c.query(`insert into public.time_off (tenant_id, resource_id, during, reason) values ($1, $2, tstzrange('2026-10-27 12:00Z', '2026-10-28 00:00Z'), 'dentist')`, [
        tenant,
        byKey["amira"],
      ]);
      const colour = locals(await slots(c, tenant, "colour", TUE, EARLY));
      expect(colour).toEqual(["09:00", "09:15", "09:30", "09:45"]); // must finish (+buffer 15) by 12:00
    }));

  it("existing allocations block the resource for duration + buffer", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "salon");
      await c.query(
        `select public.create_booking_hold($1, 'cut', '2026-10-27T10:00:00Z', 'a@b.co', 'A', null, $2::uuid[], 'online', 15, $3)`,
        [tenant, [byKey["amira"]], EARLY],
      );
      // Amira is the only Tuesday cutter: booked 10:00-10:45, buffer to 10:55
      const cut = locals(await slots(c, tenant, "cut", TUE, EARLY));
      expect(cut).toContain("09:00"); // 09:00+45 = 09:45 ... but buffer runs to 09:55 < 10:00: free
      expect(cut).not.toContain("09:15"); // its buffer would end 10:10, overlapping the booking
      expect(cut).not.toContain("10:45"); // inside the booked buffer
      expect(cut).toContain("11:00");
      // finer step exposes the exact buffer boundary
      const fine = locals(await slots(c, tenant, "cut", TUE, EARLY, 5));
      expect(fine).not.toContain("10:50");
      expect(fine).toContain("10:55");
      expect(fine).toContain("09:05"); // 09:05+55 = 10:00, adjacent
      expect(fine).not.toContain("09:10");
    }));

  it("combination services need every kind; candidates list each kind", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "spa");
      // Monday: only Lena works (Kai Fri-Sun); two rooms
      const mon = await slots(c, tenant, "swedish-60", "2026-11-02", "2026-10-30T08:00:00Z");
      expect(mon).toHaveLength(37); // 10:00..19:00 every 15 min
      expect(mon[0]!.candidates).toEqual({ staff: [byKey["lena"]], room: [byKey["room-1"], byKey["room-2"]].sort() });
      const fri = await slots(c, tenant, "swedish-60", "2026-11-06", "2026-10-30T08:00:00Z");
      expect(fri[0]!.candidates["staff"]!.sort()).toEqual([byKey["lena"], byKey["kai"]].sort());
    }));

  it("rejects class services and unknown services", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "gym");
      expect((await pgError(c, () => slots(c, tenant, "spin-45", TUE, EARLY))).code).toBe("22023");
      expect((await pgError(c, () => slots(c, tenant, "nope", TUE, EARLY))).code).toBe("P0002");
    }));
});

describe("available_slots: DST", () => {
  const NOW = "2026-03-20T08:00:00Z";

  it("spring forward (2026-03-29): local grid unchanged, UTC shifts by an hour", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "padel");
      const sat = await slots(c, tenant, "court-60", "2026-03-28", NOW, 60);
      const sun = await slots(c, tenant, "court-60", "2026-03-29", NOW, 60);
      expect(locals(sat)).toEqual(locals(sun));
      expect(sat).toHaveLength(15); // 07:00..21:00
      expect(utc(sat[0]!.starts_at)).toBe("07:00"); // GMT
      expect(utc(sun[0]!.starts_at)).toBe("06:00"); // BST
      for (const s of sun) expect(s.ends_at.getTime() - s.starts_at.getTime()).toBe(3_600_000);
    }));

  it("fall back (2026-10-25): same local grid, UTC shifts the other way", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "padel");
      const sat = await slots(c, tenant, "court-60", "2026-10-24", "2026-10-20T08:00:00Z", 60);
      const sun = await slots(c, tenant, "court-60", "2026-10-25", "2026-10-20T08:00:00Z", 60);
      expect(locals(sat)).toEqual(locals(sun));
      expect(utc(sat[0]!.starts_at)).toBe("06:00");
      expect(utc(sun[0]!.starts_at)).toBe("07:00");
    }));

  it("a booking made in BST still blocks the right local slot after the clocks change", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "padel");
      // Book court-1 on fall-back Sunday at 10:00 local (= 10:00Z after change)
      await c.query(`select public.create_booking_hold($1, 'court-60', '2026-10-25T10:00:00Z', 'a@b.co', 'A', null, $2::uuid[], 'online', 60, $3)`, [
        tenant,
        [byKey["court-1"]],
        "2026-10-20T08:00:00Z",
      ]);
      const sun = await slots(c, tenant, "court-60", "2026-10-25", "2026-10-20T08:00:00Z", 60);
      const ten = sun.find((s) => local(s.starts_at) === "10:00")!;
      expect(ten.candidates["court"]).toHaveLength(3);
      expect(ten.candidates["court"]).not.toContain(byKey["court-1"]);
    }));
});

describe("available_sessions", () => {
  it("lists future sessions with spots_left and free spot resources", () =>
    withTx(async (c) => {
      const { tenant, byKey } = await setup(c, "gym");
      const r = await c.query<{ session_id: string; spots_left: number; free_spots: string[]; spot_kind: string }>(
        `select * from public.available_sessions($1, now(), now() + interval '14 days')`,
        [tenant],
      );
      expect(r.rows.length).toBeGreaterThanOrEqual(7);
      const first = r.rows[0]!;
      expect(first.spot_kind).toBe("bike");
      expect(first.free_spots).toHaveLength(12);
      await c.query(`select public.book_class_spot($1, $2, 'a@b.co', 'A', null, $3)`, [tenant, first.session_id, byKey["bike-3"]]);
      const after = await c.query<{ spots_left: number; free_spots: string[] }>(
        `select spots_left, free_spots from public.available_sessions($1, now(), now() + interval '14 days') where session_id = $2`,
        [tenant, first.session_id],
      );
      expect(after.rows[0]).toEqual({ spots_left: first.spots_left - 1, free_spots: first.free_spots.filter((x) => x !== byKey["bike-3"]) });
    }));

  it("hides sessions inside minNotice and beyond maxAdvance", () =>
    withTx(async (c) => {
      const { tenant } = await setup(c, "gym"); // minNotice 30, maxAdvance 14
      const all = await c.query(`select starts_at from public.available_sessions($1, now() - interval '1 year', now() + interval '1 year')`, [tenant]);
      const now = Date.now();
      for (const row of all.rows as { starts_at: Date }[]) {
        expect(row.starts_at.getTime()).toBeGreaterThanOrEqual(now + 30 * 60_000 - 5_000);
        expect(row.starts_at.getTime()).toBeLessThan(now + 14 * 86_400_000);
      }
    }));
});
