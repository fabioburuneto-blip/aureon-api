-- =============================================================================
-- SaaS Barbearias — 6: apoio à área logada (painel e admin)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Slugs reservados: rotas fixas do sistema não podem virar endereço de barbearia
-- -----------------------------------------------------------------------------
alter table public.barbearias
  add constraint barbearias_slug_reservado check (
    slug not in ('entrar', 'sair', 'login', 'logout', 'painel', 'admin', 'api', 'auth',
                 'app', 'www', 'static', 'public', 'assets', 'demo-admin', 'suporte', 'ajuda')
  );

-- -----------------------------------------------------------------------------
-- Profissionais e horários de trabalho: leitura para a equipe, escrita só do dono
-- (bloqueios continuam editáveis por dono e barbeiro)
-- -----------------------------------------------------------------------------
drop policy "profissionais: equipe da barbearia gerencia" on public.profissionais;
drop policy "disponibilidade: equipe da barbearia gerencia" on public.disponibilidade;

do $$
declare
  t text;
begin
  foreach t in array array['profissionais', 'disponibilidade']
  loop
    execute format($f$
      create policy "%1$s: equipe da barbearia le"
        on public.%1$I for select to authenticated
        using ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()))
    $f$, t);
    execute format($f$
      create policy "%1$s: dono gerencia"
        on public.%1$I for all to authenticated
        using ((select private.is_superadmin())
               or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id())))
        with check ((select private.is_superadmin())
               or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id())))
    $f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Resumo de clientes (visitas = agendamentos concluídos). security_invoker faz a
-- view respeitar o RLS de quem consulta: cada equipe só vê os próprios clientes.
-- -----------------------------------------------------------------------------
create or replace view public.clientes_resumo
with (security_invoker = true) as
select
  c.id,
  c.barbearia_id,
  c.nome,
  c.telefone,
  count(a.id) filter (where a.status = 'concluido')                           as visitas,
  max(a.inicio) filter (where a.status = 'concluido')                         as ultima_visita,
  min(a.inicio) filter (where a.status = 'confirmado' and a.inicio > now())   as proximo_agendamento,
  count(a.id) filter (where a.status = 'faltou')                              as faltas
from public.clientes c
left join public.agendamentos a on a.cliente_id = c.id
group by c.id;

revoke all on public.clientes_resumo from anon, authenticated;
grant select on public.clientes_resumo to authenticated;

-- -----------------------------------------------------------------------------
-- Salva a grade semanal de um profissional numa transação só (apaga e regrava).
-- security invoker: o RLS decide quem pode (dono da barbearia ou superadmin).
-- p_itens: [{"dia_semana": 1, "hora_inicio": "09:00", "hora_fim": "12:00"}, ...]
-- -----------------------------------------------------------------------------
create or replace function public.salvar_disponibilidade(p_profissional_id uuid, p_itens jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_barbearia_id uuid;
  v_qtd integer;
begin
  select p.barbearia_id into v_barbearia_id from public.profissionais p where p.id = p_profissional_id;
  if v_barbearia_id is null then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;

  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato inválido.' using errcode = '22023';
  end if;

  -- intervalos do mesmo dia não podem se sobrepor
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality a(v, i)
      join jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality b(v, j) on a.i < b.j
     where (a.v->>'dia_semana')::int = (b.v->>'dia_semana')::int
       and (a.v->>'hora_inicio')::time < (b.v->>'hora_fim')::time
       and (b.v->>'hora_inicio')::time < (a.v->>'hora_fim')::time
  ) then
    raise exception 'Há intervalos sobrepostos no mesmo dia.' using errcode = '22023';
  end if;

  delete from public.disponibilidade where profissional_id = p_profissional_id;

  insert into public.disponibilidade (barbearia_id, profissional_id, dia_semana, hora_inicio, hora_fim)
  select v_barbearia_id, p_profissional_id, (x->>'dia_semana')::smallint, (x->>'hora_inicio')::time, (x->>'hora_fim')::time
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke execute on function public.salvar_disponibilidade(uuid, jsonb) from public, anon;
grant execute on function public.salvar_disponibilidade(uuid, jsonb) to authenticated;
