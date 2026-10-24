import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { TenantConfig, type TenantConfig as Config, type TenantConfigInput } from "@/engine/schema";

export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 30,
});

/** Run `fn` inside a transaction that is always rolled back: tests leave no trace. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    try {
      return await fn(c);
    } finally {
      await c.query("rollback");
    }
  } finally {
    c.release();
  }
}

export async function createUser(c: PoolClient, email = `${randomUUID()}@test.local`): Promise<string> {
  const id = randomUUID();
  await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())`,
    [id, email],
  );
  return id;
}

export async function createTenant(c: PoolClient, ownerId: string, slug = `t-${randomUUID().slice(0, 8)}`): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into public.tenants (owner_id, slug, name, timezone, currency) values ($1, $2, $2, 'Europe/London', 'gbp') returning id`,
    [ownerId, slug],
  );
  return r.rows[0]!.id;
}

export function parse(input: TenantConfigInput): Config {
  return TenantConfig.parse(input);
}

export async function applyConfig(
  c: PoolClient,
  tenantId: string,
  ownerId: string,
  config: Config,
  source: "ai" | "manual" | "rollback" = "manual",
  prompt: string | null = null,
): Promise<number> {
  const r = await c.query<{ apply_config: number }>(`select public.apply_config($1, $2, $3::jsonb, $4, $5)`, [
    tenantId,
    ownerId,
    JSON.stringify(config),
    source,
    prompt,
  ]);
  return r.rows[0]!.apply_config;
}

/** Impersonate a Supabase role within the current transaction (PostgREST-style). */
export async function actAs(c: PoolClient, role: "anon" | "authenticated", userId?: string): Promise<void> {
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
  await c.query(`set local role ${role}`);
}

export async function actAsService(c: PoolClient): Promise<void> {
  await c.query("reset role");
  await c.query(`select set_config('request.jwt.claims', '', true)`);
}

/** Run `fn` inside a savepoint and return the Postgres error it raises; the transaction stays usable. */
export async function pgError(c: PoolClient, fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await c.query("savepoint pg_error");
  try {
    await fn();
  } catch (e) {
    await c.query("rollback to savepoint pg_error");
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "", message: err.message };
  }
  await c.query("release savepoint pg_error");
  throw new Error("expected query to fail");
}
