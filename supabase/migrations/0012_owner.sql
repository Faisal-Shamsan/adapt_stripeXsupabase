-- Owner creates a tenant. Slug derived from the name, suffixed if taken. Config starts null; the chat builds it.
create or replace function public.create_tenant(p_owner uuid, p_name text) returns table (id uuid, slug text)
language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 0;
  v_id uuid;
begin
  if p_owner is null or not exists (select 1 from auth.users u where u.id = p_owner) then
    raise exception 'unknown owner' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' or length(p_name) > 60 then
    raise exception 'name required (max 60 chars)' using errcode = '22023';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if length(v_base) < 2 then v_base := 'business'; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.tenants (owner_id, slug, name, timezone, currency, published)
  values (p_owner, v_slug, trim(p_name), 'Europe/London', 'gbp', false)
  returning tenants.id into v_id;

  return query select v_id, v_slug;
end $$;

-- Publishing requires a config. Does not require Stripe: the site shows a "payments coming" notice until then.
create or replace function public.set_published(p_tenant uuid, p_owner uuid, p_published boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_tenant_owner(p_tenant, p_owner);
  if p_published and not exists (select 1 from public.tenants t where t.id = p_tenant and t.config is not null) then
    raise exception 'configure the business before publishing' using errcode = 'AD004';
  end if;
  update public.tenants set published = p_published where id = p_tenant;
end $$;

-- Rollback = apply an earlier version's config as a new version (history is append-only).
create or replace function public.rollback_config(p_tenant uuid, p_owner uuid, p_version integer) returns integer
language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb;
begin
  perform public.assert_tenant_owner(p_tenant, p_owner);
  select config into v_cfg from public.config_versions where tenant_id = p_tenant and version = p_version;
  if v_cfg is null then
    raise exception 'version % not found', p_version using errcode = 'P0002';
  end if;
  return public.apply_config(p_tenant, p_owner, v_cfg, 'rollback', format('rollback to v%s', p_version));
end $$;

-- Owner's bookings list with customer + resource labels (RLS-free read for server routes; owner checked by caller).
create or replace function public.owner_bookings(p_tenant uuid, p_owner uuid, p_from timestamptz default now() - interval '1 day', p_limit integer default 100)
returns table (
  id uuid, service_key text, status public.booking_status, source public.booking_source, starts_at timestamptz, ends_at timestamptz,
  amount_cents integer, deposit_cents integer, currency text, customer_name text, customer_email text, resources text[], created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_tenant_owner(p_tenant, p_owner);
  return query
  select b.id, b.service_key, b.status, b.source, lower(b.during), upper(b.during), b.amount_cents, b.deposit_cents, b.currency,
         c.name, c.email,
         (select array_agg(r.label order by r.label) from public.booking_allocations a join public.resources r on r.id = a.resource_id where a.booking_id = b.id and a.active),
         b.created_at
  from public.bookings b join public.customers c on c.id = b.customer_id
  where b.tenant_id = p_tenant and upper(b.during) >= p_from
  order by lower(b.during) asc
  limit p_limit;
end $$;

revoke execute on function public.create_tenant(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_published(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.rollback_config(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.owner_bookings(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
