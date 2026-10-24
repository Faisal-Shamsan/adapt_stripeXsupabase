create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(email)),
  name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, email),
  unique (id, tenant_id)
);
create index customers_user_idx on public.customers(user_id) where user_id is not null;

create type public.booking_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'refunded');
create type public.booking_source as enum ('online', 'walk_in', 'phone');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  service_key text not null,
  session_id uuid,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  status public.booking_status not null default 'pending',
  source public.booking_source not null default 'online',
  amount_cents integer not null check (amount_cents >= 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0 and deposit_cents <= amount_cents),
  currency text not null,
  hold_expires_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_refund_id text,
  manage_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (customer_id, tenant_id) references public.customers(id, tenant_id),
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id),
  check (status <> 'pending' or hold_expires_at is not null)
);
create index bookings_tenant_during_idx on public.bookings using gist (tenant_id, during);
create index bookings_customer_idx on public.bookings(customer_id);
create index bookings_session_idx on public.bookings(session_id) where session_id is not null and status in ('pending', 'confirmed');
create index bookings_hold_idx on public.bookings(hold_expires_at) where status = 'pending';
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- One row per allocated resource. `during` includes the service buffer.
-- The exclusion constraint is THE double-booking guard for one_to_one, rental, combination and floor-plan spots.
create table public.booking_allocations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  active boolean not null default true,
  foreign key (booking_id, tenant_id) references public.bookings(id, tenant_id) on delete cascade,
  foreign key (resource_id, tenant_id) references public.resources(id, tenant_id),
  exclude using gist (resource_id with =, during with &&) where (active)
);
create index booking_allocations_booking_idx on public.booking_allocations(booking_id);

create table public.stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
