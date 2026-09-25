-- Minimal local stand-in for the slice of Supabase's auth/storage schemas
-- and default role grants that our migrations and tests depend on. Only
-- for running migrations/tests against a plain local Postgres -- a real
-- Supabase project already provides the real versions of all of this.
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select case
    when array_length(string_to_array(name, '/'), 1) > 1
    then (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[]
  end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets, storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;
grant all on all tables in schema auth, storage to service_role;

-- Supabase grants anon/authenticated broad DML on every table/function it
-- creates in `public` by default (RLS is what actually restricts access,
-- same as in every migration in supabase/migrations/) -- replicate that
-- default here so objects created by the migrations that follow inherit it
-- automatically, without listing every table by name.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
