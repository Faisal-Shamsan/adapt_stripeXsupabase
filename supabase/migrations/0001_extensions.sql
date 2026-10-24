create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

grant usage on schema cron to postgres;
