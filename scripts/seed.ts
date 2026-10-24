/**
 * Dev seed: one owner (dev@adapt.local) and four published tenants from the presets.
 * Idempotent. Pass --stripe to also create a real test-mode connected account for the padel club
 * (charges stay disabled until onboarding is completed through the owner portal).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";
import { presets, type PresetKey } from "../src/engine/presets";
import { TenantConfig } from "../src/engine/schema";

const DB_URL = process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes("supabase.com") ? { rejectUnauthorized: false } : undefined });

// Local default. For a hosted DB pass SEED_OWNER_EMAIL=<your sign-in email> after signing in once there,
// so the demo tenants land on a real auth user (direct inserts into auth.users can't receive magic links).
const OWNER_EMAIL = process.env["SEED_OWNER_EMAIL"] ?? "dev@adapt.local";
const ALLOW_CREATE_USER = !process.env["SEED_OWNER_EMAIL"];
const SLUGS: Record<PresetKey, string> = { gym: "pulse-spin", salon: "fringe-and-co", spa: "stillwater-spa", padel: "harbourside-padel" };

async function main() {
  const c = await pool.connect();
  try {
    await c.query("begin");

    let owner = (await c.query<{ id: string }>(`select id from auth.users where email = $1`, [OWNER_EMAIL])).rows[0]?.id;
    if (!owner && !ALLOW_CREATE_USER) throw new Error(`no auth user with email ${OWNER_EMAIL} — sign in on the site first, then re-run`);
    if (!owner) {
      owner = (
        await c.query<{ id: string }>(
          `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
           returning id`,
          [OWNER_EMAIL],
        )
      ).rows[0]!.id;
    }

    for (const key of Object.keys(presets) as PresetKey[]) {
      const cfg = TenantConfig.parse(presets[key]);
      const slug = SLUGS[key];
      let tenant = (await c.query<{ id: string }>(`select id from public.tenants where slug = $1`, [slug])).rows[0]?.id;
      if (!tenant) {
        tenant = (
          await c.query<{ id: string }>(`insert into public.tenants (owner_id, slug, name, timezone, currency, published) values ($1, $2, $3, $4, $5, true) returning id`, [
            owner,
            slug,
            cfg.business.name,
            cfg.business.timezone,
            cfg.business.currency,
          ])
        ).rows[0]!.id;
      }
      const v = (await c.query<{ v: number }>(`select public.apply_config($1, $2, $3::jsonb, 'manual', 'seed') as v`, [tenant, owner, JSON.stringify(cfg)])).rows[0]!.v;
      console.log(`${slug.padEnd(20)} ${cfg.business.name.padEnd(20)} v${v}  http://localhost:3000/${slug}`);
    }

    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }

  if (process.argv.includes("--stripe")) {
    const { createConnectedAccount } = await import("../src/lib/stripe");
    const t = (await pool.query<{ id: string; stripe_account_id: string | null }>(`select id, stripe_account_id from public.tenants where slug = 'harbourside-padel'`)).rows[0]!;
    if (!t.stripe_account_id) {
      const acct = await createConnectedAccount(t.id, OWNER_EMAIL, "Harbourside Padel");
      await pool.query(`update public.tenants set stripe_account_id = $2 where id = $1`, [t.id, acct.id]);
      console.log(`stripe account ${acct.id} attached to harbourside-padel (complete onboarding via /api/connect/onboard)`);
    } else console.log(`stripe account already attached: ${t.stripe_account_id}`);
  }
  console.log(`owner: ${OWNER_EMAIL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
