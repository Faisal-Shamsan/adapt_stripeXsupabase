# Adapt — project rules

Multi-tenant booking SaaS. One engine, any business type, driven purely by a Zod-validated JSON config.
We are the Stripe Connect platform; tenants are Express connected accounts.

## Stack
Next.js App Router, TypeScript strict + noUncheckedIndexedAccess, Supabase (Postgres, Auth, Realtime, Storage,
pg_cron, btree_gist), Stripe Connect, Anthropic API, Zod, Tailwind, Vitest. SQL migrations in `supabase/migrations`.

## Invariants (never bypass)
- Config is the source of truth; all setup changes go through `apply_config()` in Postgres (AI, manual forms, rollback).
- Every booking invariant is enforced in the database (EXCLUDE gist on `booking_allocations`, FOR UPDATE for class capacity,
  composite `(id, tenant_id)` FKs). App code never "checks then inserts".
- RLS on every table. Writes only via server routes or SECURITY DEFINER functions after explicit ownership checks.
  Service role key never reaches the browser. Zod-validate every request body.
- Money is computed server-side from the stored config. AI emits config data only, never code; it runs only on owner actions.
- No placeholder error handling, auth checks, or TODOs in critical paths.

## Skills
Read `.devin/skills/adapt-engine` before touching `src/engine` or `supabase/migrations`.
Read `.devin/skills/sql-testing` before writing `tests/db`. Read `.devin/skills/stripe-connect` before payments work.

## Verify
- `npm run typecheck` — tsc strict
- `npm test` — Vitest (unit); `npm run test:db` needs `npx supabase start` + `npx supabase db reset`
- `npm run lint`
