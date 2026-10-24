-- Webhook idempotency: true if this is the first time we see the event.
create or replace function public.record_stripe_event(p_event_id text, p_type text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_inserted integer;
begin
  insert into public.stripe_events (event_id, type) values (p_event_id, p_type) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end $$;

-- If processing fails after recording, forget the event so Stripe's retry is processed.
create or replace function public.forget_stripe_event(p_event_id text) returns void
language sql security definer set search_path = public as $$
  delete from public.stripe_events where event_id = p_event_id
$$;

-- Owner attaches a freshly created connected account. Refuses to overwrite an existing one.
create or replace function public.attach_stripe_account(p_tenant uuid, p_owner uuid, p_account_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_updated integer;
begin
  perform public.assert_tenant_owner(p_tenant, p_owner);
  if p_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'invalid account id' using errcode = '22023';
  end if;
  update public.tenants
  set stripe_account_id = p_account_id, charges_enabled = false, payouts_enabled = false, details_submitted = false
  where id = p_tenant and stripe_account_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'tenant already has a connected account' using errcode = '23505';
  end if;
end $$;

-- account.updated webhook: returns the tenant id, or null if the account is unknown to us.
create or replace function public.sync_stripe_account(p_account_id text, p_charges boolean, p_payouts boolean, p_details boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  update public.tenants
  set charges_enabled = p_charges, payouts_enabled = p_payouts, details_submitted = p_details
  where stripe_account_id = p_account_id
  returning id into v_tenant;
  return v_tenant;
end $$;

-- Customer starts paying: validates the manage token, extends the hold so Checkout expiry matches,
-- and returns everything the server needs to build the session. Amount comes from the booking row.
create or replace function public.begin_checkout(p_booking uuid, p_token text, p_now timestamptz default now())
returns table (
  tenant_id uuid, tenant_slug text, stripe_account_id text, charges_enabled boolean,
  currency text, due_now_cents integer, description text, customer_email text, expires_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings%rowtype;
  v_t public.tenants%rowtype;
  v_svc_name text;
  v_expires timestamptz := p_now + interval '31 minutes';
begin
  select * into v_b from public.bookings b where b.id = p_booking and b.manage_token = p_token for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status <> 'pending' then
    raise exception 'booking is %', v_b.status using errcode = 'AD004';
  end if;
  if v_b.source <> 'online' then
    raise exception 'booking is not payable online' using errcode = 'AD004';
  end if;

  select * into v_t from public.tenants t where t.id = v_b.tenant_id;
  if v_t.stripe_account_id is null or not v_t.charges_enabled then
    raise exception 'tenant cannot accept payments yet' using errcode = 'AD005';
  end if;

  update public.bookings set hold_expires_at = v_expires where id = p_booking;

  select s->>'name' into v_svc_name from jsonb_array_elements(v_t.config->'services') s where s->>'key' = v_b.service_key;

  return query
  select v_t.id, v_t.slug, v_t.stripe_account_id, v_t.charges_enabled, v_b.currency,
         case when v_b.deposit_cents > 0 then v_b.deposit_cents else v_b.amount_cents end,
         coalesce(v_svc_name, v_b.service_key) || ' — ' || v_t.name,
         (select c.email from public.customers c where c.id = v_b.customer_id),
         v_expires;
end $$;

create or replace function public.set_checkout_session(p_booking uuid, p_session_id text) returns void
language sql security definer set search_path = public as $$
  update public.bookings set stripe_checkout_session_id = p_session_id where id = p_booking and status = 'pending'
$$;

-- Cancel by customer (token) or owner (user id). Decides whether a refund is owed:
-- pending holds are simply released; confirmed bookings are refunded only inside the cancellation deadline.
create or replace function public.cancel_booking(p_booking uuid, p_token text default null, p_owner uuid default null, p_now timestamptz default now())
returns table (refund boolean, payment_intent text, stripe_account_id text, status public.booking_status)
language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings%rowtype;
  v_t public.tenants%rowtype;
  v_deadline_h integer;
  v_refund boolean := false;
begin
  select * into v_b from public.bookings b where b.id = p_booking for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  select * into v_t from public.tenants t where t.id = v_b.tenant_id;

  if not ((p_token is not null and p_token = v_b.manage_token) or (p_owner is not null and p_owner = v_t.owner_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_b.status not in ('pending', 'confirmed') then
    raise exception 'booking is %', v_b.status using errcode = 'AD004';
  end if;
  if p_token is not null and p_owner is null and lower(v_b.during) <= p_now then
    raise exception 'booking has started' using errcode = 'AD004';
  end if;

  if v_b.status = 'confirmed' and v_b.stripe_payment_intent_id is not null then
    v_deadline_h := coalesce((v_t.config->'rules'->>'cancellationDeadlineHours')::integer, 24);
    v_refund := p_owner is not null or p_now <= lower(v_b.during) - make_interval(hours => v_deadline_h);
  end if;

  update public.bookings set status = 'cancelled', cancelled_at = p_now, hold_expires_at = null where id = p_booking;
  update public.booking_allocations set active = false where booking_id = p_booking and active;

  return query select v_refund, v_b.stripe_payment_intent_id, v_t.stripe_account_id, 'cancelled'::public.booking_status;
end $$;

create or replace function public.mark_refunded(p_booking uuid, p_refund_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings
  set status = 'refunded', stripe_refund_id = p_refund_id, cancelled_at = coalesce(cancelled_at, now()), hold_expires_at = null
  where id = p_booking and status in ('cancelled', 'confirmed');
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  update public.booking_allocations set active = false where booking_id = p_booking and active;
end $$;

-- Customer-facing read via token (no RLS path for anonymous customers).
create or replace function public.booking_by_token(p_booking uuid, p_token text)
returns table (
  id uuid, tenant_slug text, tenant_name text, service_key text, status public.booking_status, starts_at timestamptz, ends_at timestamptz,
  amount_cents integer, deposit_cents integer, currency text, customer_email text, customer_name text,
  cancellation_deadline_hours integer, resources text[]
)
language sql stable security definer set search_path = public as $$
  select b.id, t.slug, t.name, b.service_key, b.status, lower(b.during), upper(b.during),
         b.amount_cents, b.deposit_cents, b.currency, c.email, c.name,
         coalesce((t.config->'rules'->>'cancellationDeadlineHours')::integer, 24),
         (select array_agg(r.label order by r.label) from public.booking_allocations a join public.resources r on r.id = a.resource_id where a.booking_id = b.id and a.active)
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.customers c on c.id = b.customer_id
  where b.id = p_booking and b.manage_token = p_token
$$;

revoke execute on function public.record_stripe_event(text, text) from public, anon, authenticated;
revoke execute on function public.forget_stripe_event(text) from public, anon, authenticated;
revoke execute on function public.attach_stripe_account(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_stripe_account(text, boolean, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.begin_checkout(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_checkout_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.mark_refunded(uuid, text) from public, anon, authenticated;
revoke execute on function public.booking_by_token(uuid, text) from public, anon, authenticated;
