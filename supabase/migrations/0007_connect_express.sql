-- Switch to Express-dashboard connected accounts (controller properties).
alter table public.tenants
  add column payouts_enabled boolean not null default false,
  add column details_submitted boolean not null default false;

-- Any account created before this migration was a full-dashboard account: force re-onboarding.
update public.tenants
set stripe_account_id = null,
    charges_enabled = false,
    payouts_enabled = false,
    details_submitted = false
where stripe_account_id is not null;
