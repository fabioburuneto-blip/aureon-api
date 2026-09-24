-- Public bucket for business logos/cover images. Objects are stored under
-- `{business_id}/...` so ownership can be checked from the path itself,
-- reusing the same is_business_owner() helper as every other RLS policy.
insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', true)
on conflict (id) do nothing;

create policy "business_assets_public_read" on storage.objects
  for select using (bucket_id = 'business-assets');

create policy "business_assets_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'business-assets'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "business_assets_owner_update" on storage.objects
  for update
  using (
    bucket_id = 'business-assets'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'business-assets'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "business_assets_owner_delete" on storage.objects
  for delete
  using (
    bucket_id = 'business-assets'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid)
  );
