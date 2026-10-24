-- Error codes (mapped by the API):
--   AD001 class full            -> 409
--   AD002 slot unavailable      -> 409   (also booking-window violations)
--   AD003 spot invalid/required -> 422
--   23P01 exclusion race        -> 409

create or replace function public.upsert_customer(p_tenant uuid, p_email text, p_name text, p_phone text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name required' using errcode = '22023';
  end if;
  insert into public.customers (tenant_id, email, name, phone)
  values (p_tenant, lower(trim(p_email)), trim(p_name), nullif(trim(p_phone), ''))
  on conflict (tenant_id, email) do update
    set name = excluded.name, phone = coalesce(excluded.phone, customers.phone)
  returning id into v_id;
  return v_id;
end $$;

-- Book a non-class service. Re-validates via available_slots, picks resources (preferences first,
-- then deterministic fill), creates the booking and one allocation per resource in this transaction.
-- Concurrent winners are decided by the exclusion constraint (23P01).
create or replace function public.create_booking_hold(
  p_tenant uuid,
  p_service_key text,
  p_starts_at timestamptz,
  p_email text,
  p_name text,
  p_phone text default null,
  p_resource_prefs uuid[] default '{}',
  p_source public.booking_source default 'online',
  p_step_min integer default 15,
  p_now timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_tz text;
  v_svc jsonb;
  v_slot record;
  v_req record;
  v_cands uuid[];
  v_pick uuid[];
  v_ids uuid[] := '{}';
  v_pref uuid;
  v_customer uuid;
  v_booking uuid;
  v_price integer;
  v_deposit integer := 0;
  v_buf integer;
  v_status public.booking_status;
  v_hold timestamptz;
  v_attempt integer;
begin
  select config into v_cfg from public.tenants where id = p_tenant for share;
  if v_cfg is null then
    raise exception 'tenant not found or not configured' using errcode = 'P0002';
  end if;
  v_tz := v_cfg->'business'->>'timezone';

  select s into v_svc from jsonb_array_elements(v_cfg->'services') s where s->>'key' = p_service_key;
  if v_svc is null then
    raise exception 'unknown service %', p_service_key using errcode = 'P0002';
  end if;

  v_customer := public.upsert_customer(p_tenant, p_email, p_name, p_phone);

  v_price := (v_svc->>'priceCents')::integer;
  if v_cfg->'rules'->'payment'->>'mode' = 'deposit' then
    v_deposit := round(v_price * (v_cfg->'rules'->'payment'->>'depositPercent')::integer / 100.0)::integer;
  end if;
  v_buf := coalesce((v_svc->>'bufferMin')::integer, 0);

  if p_source = 'online' then
    v_status := 'pending';
    v_hold := p_now + interval '31 minutes';
  else
    v_status := 'confirmed';
    v_hold := null;
  end if;

  -- Under contention two callers may auto-pick the same resource; the loser's insert raises 23P01
  -- (after waiting for the winner to commit). With no explicit preference we re-read availability,
  -- which now excludes the winner's allocation, and pick again. Each attempt is a subtransaction.
  for v_attempt in 1..5 loop
    begin
      v_ids := '{}';

      select * into v_slot
      from public.available_slots(p_tenant, p_service_key, (p_starts_at at time zone v_tz)::date, p_step_min, p_now) a
      where a.starts_at = p_starts_at;
      if not found then
        raise exception 'slot unavailable' using errcode = 'AD002';
      end if;

      for v_req in
        select r->>'kind' as kind, (r->>'count')::integer as cnt from jsonb_array_elements(v_svc->'requires') r
      loop
        select coalesce(array_agg(x::uuid), '{}') into v_cands from jsonb_array_elements_text(v_slot.candidates->v_req.kind) x;
        select coalesce(array_agg(p), '{}') into v_pick from unnest(p_resource_prefs) p where p = any(v_cands);
        if cardinality(v_pick) > v_req.cnt then
          raise exception 'too many preferred resources of kind %', v_req.kind using errcode = '22023';
        end if;
        select v_pick || coalesce(array_agg(c), '{}') into v_pick
        from (
          select c from unnest(v_cands) c where not (c = any(v_pick)) order by c limit v_req.cnt - cardinality(v_pick)
        ) fill;
        v_ids := v_ids || v_pick;
      end loop;

      foreach v_pref in array p_resource_prefs loop
        if not (v_pref = any(v_ids)) then
          raise exception 'preferred resource unavailable' using errcode = 'AD002';
        end if;
      end loop;

      insert into public.bookings (tenant_id, customer_id, service_key, during, status, source, amount_cents, deposit_cents, currency, hold_expires_at)
      values (p_tenant, v_customer, p_service_key, tstzrange(v_slot.starts_at, v_slot.ends_at), v_status, p_source,
              v_price, v_deposit, v_cfg->'business'->>'currency', v_hold)
      returning id into v_booking;

      insert into public.booking_allocations (booking_id, tenant_id, resource_id, during)
      select v_booking, p_tenant, rid, tstzrange(v_slot.starts_at, v_slot.ends_at + make_interval(mins => v_buf))
      from unnest(v_ids) rid;

      return v_booking;
    exception when exclusion_violation then
      if cardinality(p_resource_prefs) > 0 or v_attempt = 5 then
        raise;
      end if;
    end;
  end loop;
end $$;

-- Book a seat in a class session. The FOR UPDATE on class_sessions serialises capacity checks;
-- spot classes additionally allocate the chosen resource so the exclusion constraint guards the spot.
create or replace function public.book_class_spot(
  p_tenant uuid,
  p_session_id uuid,
  p_email text,
  p_name text,
  p_phone text default null,
  p_spot uuid default null,
  p_source public.booking_source default 'online',
  p_now timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_sess public.class_sessions%rowtype;
  v_svc jsonb;
  v_taken integer;
  v_customer uuid;
  v_booking uuid;
  v_price integer;
  v_deposit integer := 0;
  v_status public.booking_status;
  v_hold timestamptz;
begin
  select config into v_cfg from public.tenants where id = p_tenant for share;
  if v_cfg is null then
    raise exception 'tenant not found or not configured' using errcode = 'P0002';
  end if;

  select * into v_sess from public.class_sessions where id = p_session_id and tenant_id = p_tenant for update;
  if not found or not v_sess.active then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_sess.starts_at < p_now + make_interval(mins => coalesce((v_cfg->'rules'->>'minNoticeMin')::integer, 60)) then
    raise exception 'booking window closed' using errcode = 'AD002';
  end if;
  if v_sess.starts_at >= p_now + make_interval(days => coalesce((v_cfg->'rules'->>'maxAdvanceDays')::integer, 30)) then
    raise exception 'too far in advance' using errcode = 'AD002';
  end if;

  if v_sess.spot_kind is not null then
    if p_spot is null then
      raise exception 'spot required' using errcode = 'AD003';
    end if;
    if not exists (
      select 1 from public.resources r where r.id = p_spot and r.tenant_id = p_tenant and r.kind = v_sess.spot_kind and r.active
    ) then
      raise exception 'invalid spot' using errcode = 'AD003';
    end if;
  elsif p_spot is not null then
    raise exception 'this class has no spots' using errcode = 'AD003';
  end if;

  select count(*) into v_taken from public.bookings b
  where b.session_id = p_session_id and b.status in ('pending', 'confirmed');
  if v_taken >= v_sess.capacity then
    raise exception 'class full' using errcode = 'AD001';
  end if;

  select s into v_svc from jsonb_array_elements(v_cfg->'services') s where s->>'key' = v_sess.service_key;
  if v_svc is null then
    raise exception 'service % no longer in config', v_sess.service_key using errcode = 'P0002';
  end if;

  v_customer := public.upsert_customer(p_tenant, p_email, p_name, p_phone);

  v_price := (v_svc->>'priceCents')::integer;
  if v_cfg->'rules'->'payment'->>'mode' = 'deposit' then
    v_deposit := round(v_price * (v_cfg->'rules'->'payment'->>'depositPercent')::integer / 100.0)::integer;
  end if;

  if p_source = 'online' then
    v_status := 'pending';
    v_hold := p_now + interval '31 minutes';
  else
    v_status := 'confirmed';
    v_hold := null;
  end if;

  insert into public.bookings (tenant_id, customer_id, service_key, session_id, during, status, source, amount_cents, deposit_cents, currency, hold_expires_at)
  values (p_tenant, v_customer, v_sess.service_key, v_sess.id, tstzrange(v_sess.starts_at, v_sess.ends_at), v_status, p_source,
          v_price, v_deposit, v_cfg->'business'->>'currency', v_hold)
  returning id into v_booking;

  if p_spot is not null then
    insert into public.booking_allocations (booking_id, tenant_id, resource_id, during)
    values (v_booking, p_tenant, p_spot, tstzrange(v_sess.starts_at, v_sess.ends_at));
  end if;

  return v_booking;
end $$;

-- Hold lifecycle -------------------------------------------------------------------------------

create or replace function public.release_booking(p_booking uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_updated integer;
begin
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), hold_expires_at = null
  where id = p_booking and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    update public.booking_allocations set active = false where booking_id = p_booking and active;
  end if;
  return v_updated = 1;
end $$;

-- Returns the status after the call. Caller refunds if it is not 'confirmed' (hold was lost).
create or replace function public.confirm_booking(p_booking uuid, p_payment_intent text, p_checkout_session text)
returns public.booking_status
language plpgsql security definer set search_path = public as $$
declare v_status public.booking_status;
begin
  select status into v_status from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_status = 'pending' then
    update public.bookings
    set status = 'confirmed', hold_expires_at = null,
        stripe_payment_intent_id = p_payment_intent, stripe_checkout_session_id = p_checkout_session
    where id = p_booking;
    return 'confirmed';
  end if;
  update public.bookings
  set stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_checkout_session)
  where id = p_booking;
  return v_status;
end $$;

create or replace function public.expire_holds(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_id uuid;
begin
  for v_id in
    select id from public.bookings where status = 'pending' and hold_expires_at < p_now for update skip locked
  loop
    perform public.release_booking(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

select cron.schedule('expire_holds', '* * * * *', $$select public.expire_holds()$$);

revoke execute on function public.upsert_customer(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_booking_hold(uuid, text, timestamptz, text, text, text, uuid[], public.booking_source, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.book_class_spot(uuid, uuid, text, text, text, uuid, public.booking_source, timestamptz) from public, anon, authenticated;
revoke execute on function public.release_booking(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_booking(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.expire_holds(timestamptz) from public, anon, authenticated;
