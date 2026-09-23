-- =============================================================================
-- SaaS Barbearias — 8: financeiro (comissão por profissional, resumo de faturamento)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Comissão do profissional (percentual sobre o que ele atende)
-- -----------------------------------------------------------------------------
alter table public.profissionais
  add column comissao_percentual numeric(5, 2) not null default 0;

alter table public.profissionais
  add constraint profissionais_comissao_valida check (comissao_percentual between 0 and 100);

comment on column public.profissionais.comissao_percentual is 'Percentual (0-100) sobre o faturamento do profissional, usado no resumo financeiro.';

-- -----------------------------------------------------------------------------
-- 2. financeiro_resumo(inicio, fim): faturamento e comissão no intervalo
--    [p_inicio, p_fim). security invoker: RLS decide o que cada um vê
--    (equipe só enxerga a própria barbearia).
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_resumo(p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'faturamento_total', coalesce((
      select sum(a.preco_cobrado) from public.agendamentos a
       where a.status = 'concluido' and a.inicio >= p_inicio and a.inicio < p_fim
    ), 0),
    'atendimentos_total', coalesce((
      select count(*) from public.agendamentos a
       where a.status = 'concluido' and a.inicio >= p_inicio and a.inicio < p_fim
    ), 0),
    'por_profissional', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profissional_id',      pr.id,
               'nome',                 pr.nome,
               'atendimentos',         coalesce(x.atendimentos, 0),
               'faturamento',          coalesce(x.faturamento, 0),
               'comissao_percentual',  pr.comissao_percentual,
               'comissao_valor',       round(coalesce(x.faturamento, 0) * pr.comissao_percentual / 100, 2)
             ) order by coalesce(x.faturamento, 0) desc, pr.nome)
        from public.profissionais pr
        left join (
              select a.profissional_id,
                     sum(a.preco_cobrado) as faturamento,
                     count(*)             as atendimentos
                from public.agendamentos a
               where a.status = 'concluido' and a.inicio >= p_inicio and a.inicio < p_fim
               group by a.profissional_id
             ) x on x.profissional_id = pr.id
       where pr.ativo
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.financeiro_resumo(timestamptz, timestamptz) from public, anon;
grant execute on function public.financeiro_resumo(timestamptz, timestamptz) to authenticated;
