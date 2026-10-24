---
trigger: glob
globs: supabase/**/*.sql
---
- Every table: `tenant_id uuid not null references tenants(id)`, `ENABLE ROW LEVEL SECURITY`, explicit policies.
- Cross-table references carry the tenant: `foreign key (resource_id, tenant_id) references resources(id, tenant_id)`.
- Mutating functions are `SECURITY DEFINER SET search_path = public` and end with
  `REVOKE EXECUTE ON FUNCTION ... FROM public, anon, authenticated;` (service role only), unless deliberately customer-callable.
- Time math uses `timestamptz` and `AT TIME ZONE tenant_tz`; never add intervals to local timestamps across days without converting.
- Use `RAISE EXCEPTION ... USING ERRCODE` with stable codes the API maps to HTTP (42501→403, 23P01→409, P0002→404, custom `AD001` capacity→409).
