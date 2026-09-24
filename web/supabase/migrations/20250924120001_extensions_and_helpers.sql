-- Extensions
-- gen_random_uuid() is built into Postgres 15+ (used by Supabase), no pgcrypto needed.
-- btree_gist is required for the EXCLUDE constraint that prevents double-booking a professional.
create extension if not exists btree_gist;

-- Generic updated_at trigger, reused by every table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

