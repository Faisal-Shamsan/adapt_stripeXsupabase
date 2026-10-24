-- Availability engine. A slot is returned only if ALL hold:
--   business open for the whole service duration; every required kind has >= count resources that are
--   active, working (resource_hours, or inheriting business hours when the resource has no rows at all),
--   not on break, not on time_off, skilled (staff), and free for duration + buffer; start >= now + minNotice;
--   date <= today + maxAdvance. All local-time maths goes through AT TIME ZONE (DST-safe).
-- `candidates` is {kind: [resource_id, ...]} so callers can offer a picker or auto-assign.
create or replace function public.available_slots(
  p_tenant uuid,
  p_service_key text,
  p_date date,
  p_step_min integer default 15,
  p_now timestamptz default now()
) returns table (starts_at timestamptz, ends_at timestamptz, candidates jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_tz text;
  v_svc jsonb;
  v_dur integer;
  v_buf integer;
  v_min_notice integer;
  v_max_adv integer;
  v_weekday smallint;
  v_windows jsonb;
begin
  if p_step_min is null or p_step_min < 5 then
    raise exception 'step must be >= 5 minutes' using errcode = '22023';
  end if;

  select config into v_cfg from public.tenants where id = p_tenant;
  if v_cfg is null then
    raise exception 'tenant not found or not configured' using errcode = 'P0002';
  end if;
  v_tz := v_cfg->'business'->>'timezone';

  select s into v_svc from jsonb_array_elements(v_cfg->'services') s where s->>'key' = p_service_key;
  if v_svc is null then
    raise exception 'unknown service %', p_service_key using errcode = 'P0002';
  end if;
  if v_svc->>'capacityType' = 'class_with_spots' then
    raise exception 'classes are booked per session; use available_sessions' using errcode = '22023';
  end if;

  v_dur := (v_svc->>'durationMin')::integer;
  v_buf := coalesce((v_svc->>'bufferMin')::integer, 0);
  v_min_notice := coalesce((v_cfg->'rules'->>'minNoticeMin')::integer, 60);
  v_max_adv := coalesce((v_cfg->'rules'->>'maxAdvanceDays')::integer, 30);

  if p_date > (p_now at time zone v_tz)::date + v_max_adv then
    return;
  end if;

  v_weekday := extract(isodow from p_date)::integer - 1;
  v_windows := coalesce(
    v_cfg->'schedules'->'business'->((array['mon','tue','wed','thu','fri','sat','sun'])[v_weekday + 1]),
    '[]'::jsonb
  );

  return query
  with starts as (
    select p_date + ((w->>'start')::time + make_interval(mins => n * p_step_min)) as local_start
    from jsonb_array_elements(v_windows) w
    cross join lateral generate_series(
      0,
      ((extract(epoch from ((w->>'end')::time - (w->>'start')::time)) / 60)::integer - v_dur) / p_step_min
    ) n
  ),
  slots as (
    select
      (local_start at time zone v_tz) as s,
      ((local_start + make_interval(mins => v_dur)) at time zone v_tz) as e,
      ((local_start + make_interval(mins => v_dur + v_buf)) at time zone v_tz) as e_buf,
      local_start::time as ls,
      (local_start + make_interval(mins => v_dur))::time as le
    from starts
  ),
  reqs as (
    select r->>'kind' as kind, (r->>'count')::integer as cnt
    from jsonb_array_elements(v_svc->'requires') r
  ),
  eligible as (
    select sl.s, sl.e, rq.kind, rq.cnt, res.id as resource_id
    from slots sl
    cross join reqs rq
    join public.resources res
      on res.tenant_id = p_tenant and res.active and res.kind = rq.kind
     and (rq.kind <> 'staff' or p_service_key = any(res.skills))
    where sl.s >= p_now + make_interval(mins => v_min_notice)
      and (
        not exists (select 1 from public.resource_hours h where h.resource_id = res.id)
        or exists (
          select 1 from public.resource_hours h
          where h.resource_id = res.id and h.weekday = v_weekday
            and h.start_time <= sl.ls and sl.le <= h.end_time
        )
      )
      and not exists (
        select 1 from public.resource_breaks b
        where b.resource_id = res.id and b.weekday = v_weekday
          and b.start_time < sl.le and sl.ls < b.end_time
      )
      and not exists (
        select 1 from public.time_off t
        where t.resource_id = res.id and t.during && tstzrange(sl.s, sl.e_buf)
      )
      and not exists (
        select 1 from public.booking_allocations a
        where a.resource_id = res.id and a.active and a.during && tstzrange(sl.s, sl.e_buf)
      )
  ),
  per_kind as (
    select el.s, el.e, el.kind, array_agg(el.resource_id order by el.resource_id) as ids
    from eligible el
    group by el.s, el.e, el.kind, el.cnt
    having count(*) >= el.cnt
  ),
  ok as (
    select pk.s, pk.e, jsonb_object_agg(pk.kind, to_jsonb(pk.ids)) as cands
    from per_kind pk
    group by pk.s, pk.e
    having count(*) = (select count(*) from reqs)
  )
  select ok.s, ok.e, ok.cands from ok order by ok.s;
end $$;

-- Class sessions in a window with remaining capacity and (for spot classes) the free spot resources.
create or replace function public.available_sessions(
  p_tenant uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_now timestamptz default now()
) returns table (
  session_id uuid, service_key text, starts_at timestamptz, ends_at timestamptz,
  instructor_id uuid, capacity integer, spots_left integer, spot_kind text, free_spots uuid[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_min_notice integer;
  v_max_adv integer;
begin
  select config into v_cfg from public.tenants where id = p_tenant;
  if v_cfg is null then
    raise exception 'tenant not found or not configured' using errcode = 'P0002';
  end if;
  v_min_notice := coalesce((v_cfg->'rules'->>'minNoticeMin')::integer, 60);
  v_max_adv := coalesce((v_cfg->'rules'->>'maxAdvanceDays')::integer, 30);

  return query
  select
    cs.id, cs.service_key, cs.starts_at, cs.ends_at, cs.instructor_id, cs.capacity,
    (cs.capacity - (
      select count(*) from public.bookings b
      where b.session_id = cs.id and b.status in ('pending', 'confirmed')
    ))::integer as spots_left,
    cs.spot_kind,
    case when cs.spot_kind is null then null else (
      select array_agg(r.id order by r.key)
      from public.resources r
      where r.tenant_id = p_tenant and r.active and r.kind = cs.spot_kind
        and not exists (
          select 1 from public.booking_allocations a
          where a.resource_id = r.id and a.active and a.during && tstzrange(cs.starts_at, cs.ends_at)
        )
    ) end as free_spots
  from public.class_sessions cs
  where cs.tenant_id = p_tenant
    and cs.active
    and cs.starts_at >= greatest(p_from, p_now + make_interval(mins => v_min_notice))
    and cs.starts_at < least(p_to, p_now + make_interval(days => v_max_adv))
  order by cs.starts_at;
end $$;

revoke execute on function public.available_slots(uuid, text, date, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.available_sessions(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
