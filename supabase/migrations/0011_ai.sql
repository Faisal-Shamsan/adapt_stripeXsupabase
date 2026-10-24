-- Sliding-window rate limit per tenant for AI turns. Returns true if the turn may proceed.
create or replace function public.consume_ai_turn(p_tenant uuid, p_limit integer default 30, p_window interval default interval '1 hour', p_now timestamptz default now())
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into public.ai_rate_limits (tenant_id, window_start, count) values (p_tenant, p_now, 0)
  on conflict (tenant_id) do nothing;

  update public.ai_rate_limits
  set window_start = case when window_start + p_window <= p_now then p_now else window_start end,
      count = case when window_start + p_window <= p_now then 0 else count end
  where tenant_id = p_tenant;

  update public.ai_rate_limits set count = count + 1 where tenant_id = p_tenant and count < p_limit
  returning count into v_count;
  return v_count is not null;
end $$;

-- Insertion order must not depend on timestamps (ties inside one transaction).
alter table public.chat_messages add column seq bigint generated always as identity;
create index chat_messages_tenant_seq_idx on public.chat_messages(tenant_id, seq desc);
drop index if exists public.chat_messages_tenant_idx;

-- Last N messages, oldest first, as the model sees them.
create or replace function public.recent_chat(p_tenant uuid, p_limit integer default 6)
returns table (role text, content jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.role, m.content, m.created_at
  from (select * from public.chat_messages where tenant_id = p_tenant order by seq desc limit p_limit) m
  order by m.seq asc
$$;

create or replace function public.append_chat(p_tenant uuid, p_role text, p_content jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_role not in ('user', 'assistant') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  insert into public.chat_messages (tenant_id, role, content) values (p_tenant, p_role, p_content) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.consume_ai_turn(uuid, integer, interval, timestamptz) from public, anon, authenticated;
revoke execute on function public.recent_chat(uuid, integer) from public, anon, authenticated;
revoke execute on function public.append_chat(uuid, text, jsonb) from public, anon, authenticated;
