-- =============================================================================
-- SaaS Barbearias — 4/4: storage (bucket público "barbearias")
--
-- Convenção de caminho: <barbearia_id>/<qualquer/coisa>.<ext>
--   ex.: 3f1c.../logo.png, 3f1c.../galeria/foto-01.jpg
-- Leitura: pública pela URL pública do bucket.
-- Escrita: somente a equipe da barbearia dona da pasta, ou o superadmin.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'barbearias',
  'barbearias',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Listar arquivos pela API (o download pela URL pública não depende disso).
create policy "barbearias bucket: equipe lista a propria pasta"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'barbearias'
    and ((select private.is_superadmin())
         or (storage.foldername(name))[1] = (select private.minha_barbearia_id())::text)
  );

create policy "barbearias bucket: equipe envia na propria pasta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'barbearias'
    and ((select private.is_superadmin())
         or (storage.foldername(name))[1] = (select private.minha_barbearia_id())::text)
  );

create policy "barbearias bucket: equipe atualiza a propria pasta"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'barbearias'
    and ((select private.is_superadmin())
         or (storage.foldername(name))[1] = (select private.minha_barbearia_id())::text)
  )
  with check (
    bucket_id = 'barbearias'
    and ((select private.is_superadmin())
         or (storage.foldername(name))[1] = (select private.minha_barbearia_id())::text)
  );

create policy "barbearias bucket: equipe remove da propria pasta"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'barbearias'
    and ((select private.is_superadmin())
         or (storage.foldername(name))[1] = (select private.minha_barbearia_id())::text)
  );
