-- Membership helpers used by RLS policies (SECURITY DEFINER avoids recursive
-- RLS lookups on business_members itself, and lets anon evaluate safely).
-- Declared after the schema so the referenced tables already exist.
create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

grant execute on function public.is_business_member(uuid) to anon, authenticated;
grant execute on function public.is_business_owner(uuid) to anon, authenticated;
