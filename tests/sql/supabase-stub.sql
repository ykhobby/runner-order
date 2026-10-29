-- Minimal stand-in for the parts of Supabase the migration relies on, for local database tests only.
create schema auth;
create schema extensions;
create role anon nologin;
create role authenticated nologin;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}');
-- Supabase reads the signed-in user from the request's JWT; tests set it with set_config.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
