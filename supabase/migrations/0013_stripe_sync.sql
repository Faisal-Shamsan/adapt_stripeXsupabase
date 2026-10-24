-- Track when we last confirmed account status with Stripe so pages can re-sync lazily (throttled)
-- when flags look stale, e.g. webhooks delayed or, in local dev, never delivered.
alter table public.tenants add column stripe_synced_at timestamptz;

create or replace function public.sync_stripe_account(p_account_id text, p_charges boolean, p_payouts boolean, p_details boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  update public.tenants
  set charges_enabled = p_charges, payouts_enabled = p_payouts, details_submitted = p_details, stripe_synced_at = now()
  where stripe_account_id = p_account_id
  returning id into v_tenant;
  return v_tenant;
end $$;
