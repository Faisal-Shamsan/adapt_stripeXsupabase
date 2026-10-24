create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  kind text not null,
  label text not null,
  position jsonb,
  skills text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (id, tenant_id)
);
create index resources_tenant_kind_idx on public.resources(tenant_id, kind) where active;
create trigger resources_updated_at before update on public.resources
  for each row execute function public.set_updated_at();

-- Weekly working hours per resource, local HH:MM in the tenant timezone.
-- Projected from config on every apply_config; a resource with no rows inherits business hours.
create table public.resource_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Monday
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (resource_id, tenant_id) references public.resources(id, tenant_id) on delete cascade
);
create index resource_hours_resource_idx on public.resource_hours(resource_id, weekday);

create table public.resource_breaks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (resource_id, tenant_id) references public.resources(id, tenant_id) on delete cascade
);
create index resource_breaks_resource_idx on public.resource_breaks(resource_id, weekday);

-- Owner-managed, not part of config.
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  reason text,
  created_at timestamptz not null default now(),
  foreign key (resource_id, tenant_id) references public.resources(id, tenant_id) on delete cascade
);
create index time_off_resource_during_idx on public.time_off using gist (resource_id, during);

-- Recurring class sessions materialised for the next 8 weeks (extended daily by pg_cron).
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_key text not null,
  service_key text not null,
  instructor_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  spot_kind text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  unique (tenant_id, session_key, starts_at),
  unique (id, tenant_id),
  foreign key (instructor_id, tenant_id) references public.resources(id, tenant_id)
);
create index class_sessions_tenant_starts_idx on public.class_sessions(tenant_id, starts_at) where active;
