-- 090_readonly_role.sql
-- Dedicated read-only login role for the backend. Run as `postgres` in the Supabase SQL editor.
--
-- BEFORE RUNNING: replace REPLACE_WITH_A_LONG_RANDOM_PASSWORD with a generated password (24+ characters) IN THE EDITOR ONLY.
-- Never commit the real password. Then DATABASE_URL =
--   postgresql://intel_reader.<project-ref>:<password>@<pooler-host from Connect, e.g. aws-1-us-east-1.pooler.supabase.com>:6543/postgres
--
-- The role can read ONLY the published intel views (never the raw public tables, so PII columns are unreachable),
-- and execute only the pure intel helper functions those views call.

do $$
declare
  pw constant text := 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
begin
  if pw like 'REPLACE_WITH%' or length(pw) < 24 then
    raise exception 'Set a real password (24+ chars) in 090_readonly_role.sql before running it.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'intel_reader') then
    execute format('create role intel_reader with login noinherit nosuperuser nocreatedb nocreaterole nobypassrls connection limit 10 password %L', pw);
  else
    -- Re-running rotates the password.
    execute format('alter role intel_reader with password %L', pw);
  end if;
end $$;

alter role intel_reader set statement_timeout = '15s';
alter role intel_reader set idle_in_transaction_session_timeout = '30s';
alter role intel_reader set default_transaction_read_only = on;
alter role intel_reader set search_path = intel;

grant usage on schema intel to intel_reader;

-- Published views only. Adapter views (intel.v_src_*) are internal and are NOT granted.
grant select on
  intel.v_brands,
  intel.v_signals,
  intel.v_switch_events,
  intel.v_topic_weekly,
  intel.v_replies,
  intel.v_data_health
to intel_reader;

-- Functions referenced inside views are permission-checked against the querying role.
grant execute on function
  intel.sentiment_5(text),
  intel.sentiment_3(text),
  intel.normalise_channel(text),
  intel.mask_pii(text),
  intel.regex_escape(text),
  intel.canonical_url(text)
to intel_reader;

-- Explicitly no access to raw data.
revoke all on all tables in schema public from intel_reader;

-- Supabase API roles never see the intel layer (it is not exposed through PostgREST either).
revoke all on all tables in schema intel from public, anon, authenticated;
revoke all on all functions in schema intel from public, anon, authenticated;
alter default privileges in schema intel revoke all on tables from public, anon, authenticated;
alter default privileges in schema intel revoke all on functions from public, anon, authenticated;
