-- =============================================================================
-- SaaS Barbearias — 5: dias_disponiveis (calendário do agendamento online)
--
-- Para os próximos N dias (padrão 30, a partir de hoje em America/Sao_Paulo),
-- retorna quantos horários livres existem em cada dia, usando exatamente as
-- mesmas regras de horarios_livres. Dias com 0 aparecem desabilitados no site.
-- =============================================================================

create or replace function public.dias_disponiveis(
  p_slug            text,
  p_servico_id      uuid,
  p_profissional_id uuid,
  p_dias            integer default 30
)
returns table (
  data     date,
  horarios integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_qtd  integer := least(greatest(coalesce(p_dias, 30), 1), 60);
  i      integer;
begin
  for i in 0 .. v_qtd - 1 loop
    data := v_hoje + i;
    select count(*)::integer into horarios
      from public.horarios_livres(p_slug, p_servico_id, p_profissional_id, v_hoje + i);
    return next;
  end loop;
end;
$$;

revoke execute on function public.dias_disponiveis(text, uuid, uuid, integer) from public;
grant execute on function public.dias_disponiveis(text, uuid, uuid, integer) to anon, authenticated;
