import { afterAll, describe, expect, it } from "vitest";
import { createTenant, createUser, pgError, pool, withTx } from "./_setup";

afterAll(() => pool.end());

describe("consume_ai_turn", () => {
  it("allows up to the limit inside the window, then refuses, then resets after the window", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      const turn = (now: string) => c.query<{ ok: boolean }>(`select public.consume_ai_turn($1, 3, interval '1 hour', $2::timestamptz) as ok`, [tenant, now]).then((r) => r.rows[0]!.ok);
      expect(await turn("2026-11-01T10:00:00Z")).toBe(true);
      expect(await turn("2026-11-01T10:10:00Z")).toBe(true);
      expect(await turn("2026-11-01T10:20:00Z")).toBe(true);
      expect(await turn("2026-11-01T10:30:00Z")).toBe(false);
      expect(await turn("2026-11-01T10:59:00Z")).toBe(false);
      expect(await turn("2026-11-01T11:00:00Z")).toBe(true); // window elapsed
      const row = await c.query(`select count from public.ai_rate_limits where tenant_id = $1`, [tenant]);
      expect(row.rows[0]!.count).toBe(1);
    }));

  it("is per tenant", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const a = await createTenant(c, owner);
      const b = await createTenant(c, owner);
      for (let i = 0; i < 3; i++) await c.query(`select public.consume_ai_turn($1, 3)`, [a]);
      expect((await c.query(`select public.consume_ai_turn($1, 3) as ok`, [a])).rows[0]!.ok).toBe(false);
      expect((await c.query(`select public.consume_ai_turn($1, 3) as ok`, [b])).rows[0]!.ok).toBe(true);
    }));
});

describe("chat history", () => {
  it("append + recent returns the last N oldest-first and rejects bad roles", () =>
    withTx(async (c) => {
      const owner = await createUser(c);
      const tenant = await createTenant(c, owner);
      for (let i = 0; i < 8; i++) {
        await c.query(`select public.append_chat($1, $2, $3::jsonb)`, [tenant, i % 2 ? "assistant" : "user", JSON.stringify({ text: `m${i}` })]);
      }
      const r = await c.query<{ role: string; content: { text: string } }>(`select role, content from public.recent_chat($1, 6)`, [tenant]);
      expect(r.rows.map((x) => x.content.text)).toEqual(["m2", "m3", "m4", "m5", "m6", "m7"]);
      expect(r.rows[0]!.role).toBe("user");
      expect((await pgError(c, () => c.query(`select public.append_chat($1, 'system', '{}'::jsonb)`, [tenant]))).code).toBe("22023");
    }));
});
