---
name: sql-testing
description: How to write Vitest tests that exercise Postgres functions, RLS and constraints against local Supabase
triggers: [user, model]
---

# DB testing pattern

- Tests in `tests/db/*.test.ts` use `pg` directly via `DATABASE_URL` (local Supabase: port 54322).
- `tests/db/_setup.ts` exports `withTx(fn)`: `BEGIN` → run → `ROLLBACK`. Every test is isolated; no cleanup code.
- Role simulation inside a tx: `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);`
  Reset with `RESET ROLE`. Use this to prove RLS, and to prove SECURITY DEFINER functions are revoked from anon/authenticated.
- Concurrency tests cannot share one tx: open N separate clients from the pool, fire `Promise.allSettled`, assert exactly one
  success and N-1 `23P01` (exclusion_violation) or the function's capacity error; clean up with a `DELETE ... WHERE tenant_id = $1`
  on a tenant created just for that test.
- DST fixtures: Europe/London 2026-03-29 (01:00→02:00) and 2026-10-25 (02:00→01:00). Assert slot count and that the
  local `HH:MM` labels are unchanged across the change.
- Run: `npx supabase start && npx supabase db reset && npm run test:db`.
- Never mock Postgres. If a behaviour is hard to test, that's a design signal — move it into the database.
