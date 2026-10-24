-- Helper used by policies. SECURITY DEFINER so it is not itself subject to tenants' RLS.
create or replace function public.is_tenant_owner(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenants t where t.id = p_tenant and t.owner_id = auth.uid())
$$;
grant execute on function public.is_tenant_owner(uuid) to authenticated;
revoke execute on function public.is_tenant_owner(uuid) from public, anon;

alter table public.tenants enable row level security;
alter table public.config_versions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_rate_limits enable row level security;
alter table public.resources enable row level security;
alter table public.resource_hours enable row level security;
alter table public.resource_breaks enable row level security;
alter table public.time_off enable row level security;
alter table public.class_sessions enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_allocations enable row level security;
alter table public.stripe_events enable row level security;

-- Owners read their tenant's data. No insert/update/delete policies: all writes go through
-- SECURITY DEFINER functions or server routes using the service role.
create policy tenants_owner_select on public.tenants for select to authenticated using (owner_id = auth.uid());
create policy config_versions_owner_select on public.config_versions for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy chat_messages_owner_select on public.chat_messages for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy resources_owner_select on public.resources for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy resource_hours_owner_select on public.resource_hours for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy resource_breaks_owner_select on public.resource_breaks for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy time_off_owner_select on public.time_off for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy class_sessions_owner_select on public.class_sessions for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy booking_allocations_owner_select on public.booking_allocations for select to authenticated using (public.is_tenant_owner(tenant_id));

-- Customers: owner sees all; a signed-in customer sees their own record and bookings.
create policy customers_owner_select on public.customers for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy customers_self_select on public.customers for select to authenticated using (user_id = auth.uid());

create policy bookings_owner_select on public.bookings for select to authenticated using (public.is_tenant_owner(tenant_id));
create policy bookings_customer_select on public.bookings for select to authenticated
  using (exists (select 1 from public.customers c where c.id = bookings.customer_id and c.user_id = auth.uid()));

-- ai_rate_limits and stripe_events: no policies => service role only.

-- Realtime: owners subscribe to bookings; RLS above governs what they receive.
alter publication supabase_realtime add table public.bookings;
