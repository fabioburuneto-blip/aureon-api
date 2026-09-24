-- =============================================================================
-- SaaS Barbearias — 9: expõe os planos do clube no site público
-- =============================================================================

create or replace function public.barbearia_publica(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',                    b.id,
    'slug',                  b.slug,
    'nome',                  b.nome,
    'whatsapp',              b.whatsapp,
    'endereco',              b.endereco,
    'cidade',                b.cidade,
    'instagram',             b.instagram,
    'horario_funcionamento', b.horario_funcionamento,
    'tema',                  b.tema,
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'nome', s.nome, 'descricao', s.descricao,
               'preco', s.preco, 'duracao_min', s.duracao_min
             ) order by s.ordem, s.nome)
        from public.servicos s
       where s.barbearia_id = b.id and s.ativo
    ), '[]'::jsonb),
    'profissionais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'foto_url', p.foto_url
             ) order by p.ordem, p.nome)
        from public.profissionais p
       where p.barbearia_id = b.id and p.ativo
    ), '[]'::jsonb),
    'planos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pl.id, 'nome', pl.nome, 'descricao', pl.descricao,
               'preco', pl.preco, 'creditos_mes', pl.creditos_mes
             ) order by pl.ordem, pl.preco)
        from public.planos_clube pl
       where pl.barbearia_id = b.id and pl.ativo
    ), '[]'::jsonb)
  )
  from public.barbearias b
  where b.slug = lower(btrim(p_slug))
    and b.ativo;
$$;
