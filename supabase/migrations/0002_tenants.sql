create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name text not null,
  timezone text not null,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  config jsonb,
  config_version integer not null default 0,
  stripe_account_id text unique,
  charges_enabled boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenants_owner_idx on public.tenants(owner_id);

create table public.config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null,
  config jsonb not null,
  source text not null check (source in ('ai', 'manual', 'rollback')),
  prompt text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index chat_messages_tenant_idx on public.chat_messages(tenant_id, created_at desc);

create table public.ai_rate_limits (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0
);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tenants_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

-- Ownership check used by every mutating function.
create or replace function public.assert_tenant_owner(p_tenant uuid, p_user uuid) returns void
language plpgsql stable as $$
begin
  if p_user is null or not exists (select 1 from public.tenants t where t.id = p_tenant and t.owner_id = p_user) then
    raise exception 'not tenant owner' using errcode = '42501';
  end if;
end $$;
