-- weekday text ('mon'..'sun') -> 0..6 (Monday = 0), matching resource_hours.weekday
create or replace function public.weekday_index(p text) returns smallint
language sql immutable strict as $$
  select case p
    when 'mon' then 0 when 'tue' then 1 when 'wed' then 2 when 'thu' then 3
    when 'fri' then 4 when 'sat' then 5 when 'sun' then 6
  end::smallint
$$;

-- Materialise class sessions from a config for [p_from, p_to) local dates. Upsert only; never deactivates.
-- Timezone-correct: builds the local timestamp first, then converts with AT TIME ZONE.
create or replace function public.project_class_sessions(
  p_tenant uuid, p_config jsonb, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := p_config->'business'->>'timezone';
  v_count integer;
begin
  with sessions as (
    select
      cs->>'key' as session_key,
      cs->>'serviceKey' as service_key,
      public.weekday_index(cs->>'weekday') as weekday,
      (cs->>'start')::time as start_time,
      cs->>'instructorKey' as instructor_key
    from jsonb_array_elements(coalesce(p_config->'schedules'->'classSessions', '[]'::jsonb)) cs
  ),
  services as (
    select
      s->>'key' as service_key,
      (s->>'durationMin')::integer as duration_min,
      (s->>'capacity')::integer as capacity,
      s->>'spotKind' as spot_kind
    from jsonb_array_elements(p_config->'services') s
    where s->>'capacityType' = 'class_with_spots'
  ),
  days as (
    select d::date as d from generate_series(p_from, p_to - 1, interval '1 day') d
  ),
  desired as (
    select
      ss.session_key, ss.service_key,
      r.id as instructor_id,
      ((days.d + ss.start_time) at time zone v_tz) as starts_at,
      ((days.d + ss.start_time + make_interval(mins => sv.duration_min)) at time zone v_tz) as ends_at,
      sv.capacity, sv.spot_kind
    from sessions ss
    join services sv on sv.service_key = ss.service_key
    join days on (extract(isodow from days.d)::int - 1) = ss.weekday
    left join public.resources r on r.tenant_id = p_tenant and r.key = ss.instructor_key
  ),
  upserted as (
    insert into public.class_sessions (tenant_id, session_key, service_key, instructor_id, starts_at, ends_at, capacity, spot_kind, active)
    select p_tenant, session_key, service_key, instructor_id, starts_at, ends_at, capacity, spot_kind, true from desired
    on conflict (tenant_id, session_key, starts_at) do update
      set service_key = excluded.service_key,
          instructor_id = excluded.instructor_id,
          ends_at = excluded.ends_at,
          capacity = excluded.capacity,
          spot_kind = excluded.spot_kind,
          active = true
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end $$;

-- Atomically version a config and project it into relational tables.
create or replace function public.apply_config(
  p_tenant uuid, p_owner uuid, p_config jsonb, p_source text, p_prompt text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_version integer;
  v_tz text;
  v_today date;
begin
  perform public.assert_tenant_owner(p_tenant, p_owner);

  if p_source not in ('ai', 'manual', 'rollback') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;

  -- The DB does not trust the app: minimal shape checks so projection cannot silently produce garbage.
  if jsonb_typeof(p_config) is distinct from 'object'
     or (p_config->>'version')::int is distinct from 1
     or jsonb_typeof(p_config->'business') is distinct from 'object'
     or jsonb_typeof(p_config->'resources') is distinct from 'array'
     or jsonb_typeof(p_config->'services') is distinct from 'array'
     or jsonb_typeof(p_config->'schedules') is distinct from 'object'
     or jsonb_typeof(p_config->'rules') is distinct from 'object'
     or jsonb_typeof(p_config->'ui') is distinct from 'object'
     or coalesce(jsonb_array_length(p_config->'resources'), 0) = 0
     or coalesce(jsonb_array_length(p_config->'services'), 0) = 0 then
    raise exception 'config shape invalid' using errcode = '22023';
  end if;

  v_tz := p_config->'business'->>'timezone';
  begin
    perform now() at time zone v_tz;
  exception when others then
    raise exception 'invalid timezone %', v_tz using errcode = '22023';
  end;

  -- Serialise concurrent applies for this tenant.
  select config_version + 1 into v_version from public.tenants where id = p_tenant for update;

  insert into public.config_versions (tenant_id, version, config, source, prompt, created_by)
  values (p_tenant, v_version, p_config, p_source, p_prompt, p_owner);

  update public.tenants
  set config = p_config,
      config_version = v_version,
      name = p_config->'business'->>'name',
      timezone = v_tz,
      currency = lower(p_config->'business'->>'currency')
  where id = p_tenant;

  -- Resources: upsert by key, deactivate the rest.
  insert into public.resources (tenant_id, key, kind, label, position, skills, active)
  select p_tenant, r->>'key', r->>'kind', r->>'label',
         nullif(r->'position', 'null'::jsonb),
         coalesce(array(select jsonb_array_elements_text(coalesce(r->'skills', '[]'::jsonb))), '{}'),
         true
  from jsonb_array_elements(p_config->'resources') r
  on conflict (tenant_id, key) do update
    set kind = excluded.kind, label = excluded.label, position = excluded.position,
        skills = excluded.skills, active = true;

  update public.resources
  set active = false
  where tenant_id = p_tenant
    and active
    and key not in (select r->>'key' from jsonb_array_elements(p_config->'resources') r);

  -- Working hours & breaks: full replace.
  delete from public.resource_hours where tenant_id = p_tenant;
  delete from public.resource_breaks where tenant_id = p_tenant;

  insert into public.resource_hours (tenant_id, resource_id, weekday, start_time, end_time)
  select p_tenant, res.id, public.weekday_index(day.key), (w->>'start')::time, (w->>'end')::time
  from jsonb_array_elements(coalesce(p_config->'schedules'->'resources', '[]'::jsonb)) rs
  join public.resources res on res.tenant_id = p_tenant and res.key = rs->>'resourceKey'
  cross join lateral jsonb_each(rs->'hours') day
  cross join lateral jsonb_array_elements(day.value) w;

  insert into public.resource_breaks (tenant_id, resource_id, weekday, start_time, end_time)
  select p_tenant, res.id, public.weekday_index(day.key), (w->>'start')::time, (w->>'end')::time
  from jsonb_array_elements(coalesce(p_config->'schedules'->'resources', '[]'::jsonb)) rs
  join public.resources res on res.tenant_id = p_tenant and res.key = rs->>'resourceKey'
  cross join lateral jsonb_each(coalesce(rs->'breaks', '{}'::jsonb)) day
  cross join lateral jsonb_array_elements(day.value) w;

  -- Class sessions: project the next 8 weeks, then deactivate future sessions no longer in config.
  v_today := (now() at time zone v_tz)::date;
  perform public.project_class_sessions(p_tenant, p_config, v_today, v_today + 56);

  update public.class_sessions cs
  set active = false
  where cs.tenant_id = p_tenant
    and cs.active
    and cs.starts_at >= now()
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_config->'schedules'->'classSessions', '[]'::jsonb)) s
      where s->>'key' = cs.session_key
        and s->>'serviceKey' = cs.service_key
        and public.weekday_index(s->>'weekday') = (extract(isodow from (cs.starts_at at time zone v_tz))::int - 1)
        and (s->>'start')::time = (cs.starts_at at time zone v_tz)::time
    );

  return v_version;
end $$;

-- Daily cron: keep every tenant's class_sessions materialised 8 weeks ahead.
create or replace function public.extend_class_sessions() returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_today date;
begin
  for t in select id, config, timezone from public.tenants where config is not null loop
    v_today := (now() at time zone t.timezone)::date;
    perform public.project_class_sessions(t.id, t.config, v_today + 49, v_today + 56);
  end loop;
end $$;

select cron.schedule('extend_class_sessions', '15 3 * * *', $$select public.extend_class_sessions()$$);

revoke execute on function public.weekday_index(text) from public, anon, authenticated;
revoke execute on function public.project_class_sessions(uuid, jsonb, date, date) from public, anon, authenticated;
revoke execute on function public.apply_config(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.extend_class_sessions() from public, anon, authenticated;
revoke execute on function public.assert_tenant_owner(uuid, uuid) from public, anon, authenticated;
