-- =============================================================================
-- SaaS Barbearias — 3/4: funções RPC públicas (security definer)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- barbearia_publica(slug): tudo o que o site público precisa em uma chamada.
-- Funciona com ou sem login (útil quando o dono de outra barbearia abre o site).
-- -----------------------------------------------------------------------------
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
    ), '[]'::jsonb)
  )
  from public.barbearias b
  where b.slug = lower(btrim(p_slug))
    and b.ativo;
$$;

-- -----------------------------------------------------------------------------
-- horarios_livres(slug, servico_id, profissional_id?, data)
--
-- Retorna os inícios possíveis (grade de 15 min a partir de cada hora_inicio
-- da disponibilidade) em que o serviço cabe inteiro, sem conflito com
-- bloqueios nem agendamentos não cancelados, e que ainda não passaram.
-- Com profissional_id nulo, considera qualquer profissional ativo e devolve
-- em "profissionais" quem está livre naquele horário (ordenado por "ordem").
-- -----------------------------------------------------------------------------
create or replace function public.horarios_livres(
  p_slug            text,
  p_servico_id      uuid,
  p_profissional_id uuid,
  p_data            date
)
returns table (
  inicio        timestamptz,
  fim           timestamptz,
  hora          text,
  profissionais uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_barbearia_id uuid;
  v_duracao      integer;
  v_dur          interval;
  v_tz constant  text := 'America/Sao_Paulo';
begin
  select b.id into v_barbearia_id
    from public.barbearias b
   where b.slug = lower(btrim(p_slug)) and b.ativo;
  if v_barbearia_id is null then
    raise exception 'Barbearia não encontrada.' using errcode = 'P0002';
  end if;

  select s.duracao_min into v_duracao
    from public.servicos s
   where s.id = p_servico_id and s.barbearia_id = v_barbearia_id and s.ativo;
  if v_duracao is null then
    raise exception 'Serviço não encontrado.' using errcode = 'P0002';
  end if;

  if p_profissional_id is not null and not exists (
    select 1 from public.profissionais p
     where p.id = p_profissional_id and p.barbearia_id = v_barbearia_id and p.ativo
  ) then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;

  if p_data is null or p_data < (now() at time zone v_tz)::date then
    return;
  end if;

  v_dur := make_interval(mins => v_duracao);

  return query
  with profs as (
    select p.id, p.ordem
      from public.profissionais p
     where p.barbearia_id = v_barbearia_id
       and p.ativo
       and (p_profissional_id is null or p.id = p_profissional_id)
  ),
  candidatos as (
    select distinct pr.id as profissional_id, pr.ordem, gs.t as ini
      from profs pr
      join public.disponibilidade d
        on d.profissional_id = pr.id
       and d.barbearia_id = v_barbearia_id
       and d.dia_semana = extract(dow from p_data)::int
     cross join lateral generate_series(
            (p_data + d.hora_inicio) at time zone v_tz,
            ((p_data + d.hora_fim) at time zone v_tz) - v_dur,
            interval '15 minutes'
          ) as gs(t)
  ),
  livres as (
    select c.*
      from candidatos c
     where c.ini > now()
       and not exists (
             select 1 from public.bloqueios bl
              where bl.barbearia_id = v_barbearia_id
                and (bl.profissional_id is null or bl.profissional_id = c.profissional_id)
                and tstzrange(bl.inicio, bl.fim, '[)') && tstzrange(c.ini, c.ini + v_dur, '[)')
           )
       and not exists (
             select 1 from public.agendamentos a
              where a.profissional_id = c.profissional_id
                and a.status <> 'cancelado'
                and tstzrange(a.inicio, a.fim, '[)') && tstzrange(c.ini, c.ini + v_dur, '[)')
           )
  )
  select l.ini,
         l.ini + v_dur,
         to_char(l.ini at time zone v_tz, 'HH24:MI'),
         array_agg(l.profissional_id order by l.ordem, l.profissional_id)
    from livres l
   group by l.ini
   order by l.ini;
end;
$$;

-- -----------------------------------------------------------------------------
-- criar_agendamento_publico(slug, servico_id, profissional_id?, inicio, nome, telefone)
--
-- Retorna jsonb:
--   sucesso: { ok: true, agendamento: {...}, barbearia: {...}, servico: {...},
--              profissional: {...}, cliente: {...} }
--   erro:    { ok: false, codigo: '...', mensagem: 'texto amigável' }
-- -----------------------------------------------------------------------------
create or replace function public.criar_agendamento_publico(
  p_slug            text,
  p_servico_id      uuid,
  p_profissional_id uuid,
  p_inicio          timestamptz,
  p_nome_cliente    text,
  p_telefone        text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tz constant  text := 'America/Sao_Paulo';
  v_max_futuros constant integer := 3; -- limite anti-abuso por telefone
  v_barbearia    public.barbearias%rowtype;
  v_servico      public.servicos%rowtype;
  v_prof         public.profissionais%rowtype;
  v_nome         text := btrim(coalesce(p_nome_cliente, ''));
  v_telefone     text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_data         date;
  v_candidatos   uuid[];
  v_prof_id      uuid;
  v_cliente_id   uuid;
  v_ag           public.agendamentos%rowtype;
begin
  -- Validações de entrada -----------------------------------------------------
  if length(v_nome) < 2 or length(v_nome) > 100 then
    return jsonb_build_object('ok', false, 'codigo', 'nome_invalido',
      'mensagem', 'Informe seu nome.');
  end if;

  if v_telefone !~ '^[0-9]{10,13}$' then
    return jsonb_build_object('ok', false, 'codigo', 'telefone_invalido',
      'mensagem', 'Informe um telefone válido com DDD.');
  end if;

  select * into v_barbearia
    from public.barbearias b
   where b.slug = lower(btrim(p_slug)) and b.ativo;
  if v_barbearia.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'barbearia_nao_encontrada',
      'mensagem', 'Barbearia não encontrada.');
  end if;

  select * into v_servico
    from public.servicos s
   where s.id = p_servico_id and s.barbearia_id = v_barbearia.id and s.ativo;
  if v_servico.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'servico_nao_encontrado',
      'mensagem', 'Esse serviço não está disponível.');
  end if;

  if p_profissional_id is not null and not exists (
    select 1 from public.profissionais p
     where p.id = p_profissional_id and p.barbearia_id = v_barbearia.id and p.ativo
  ) then
    return jsonb_build_object('ok', false, 'codigo', 'profissional_nao_encontrado',
      'mensagem', 'Esse profissional não está disponível.');
  end if;

  if p_inicio is null or p_inicio <= now() then
    return jsonb_build_object('ok', false, 'codigo', 'horario_passado',
      'mensagem', 'Esse horário já passou. Escolha outro horário.');
  end if;

  -- O horário precisa estar na lista de horários livres -----------------------
  v_data := (p_inicio at time zone v_tz)::date;

  select h.profissionais into v_candidatos
    from public.horarios_livres(p_slug, p_servico_id, p_profissional_id, v_data) h
   where h.inicio = p_inicio;

  if v_candidatos is null then
    return jsonb_build_object('ok', false, 'codigo', 'horario_indisponivel',
      'mensagem', 'Poxa, esse horário acabou de ser ocupado. Escolha outro horário.');
  end if;

  -- Sem preferência: distribui para quem tem menos atendimentos no dia.
  select array_agg(c.id order by (
           select count(*) from public.agendamentos a
            where a.profissional_id = c.id
              and a.status <> 'cancelado'
              and (a.inicio at time zone v_tz)::date = v_data
         ), c.pos)
    into v_candidatos
    from unnest(v_candidatos) with ordinality as c(id, pos);

  -- Cliente: reaproveita pelo telefone (não sobrescreve o nome cadastrado) ----
  insert into public.clientes (barbearia_id, nome, telefone)
  values (v_barbearia.id, v_nome, v_telefone)
  on conflict (barbearia_id, telefone) do nothing
  returning id into v_cliente_id;

  if v_cliente_id is null then
    select c.id into v_cliente_id
      from public.clientes c
     where c.barbearia_id = v_barbearia.id and c.telefone = v_telefone;
  end if;

  if (select count(*) from public.agendamentos a
       where a.cliente_id = v_cliente_id
         and a.status = 'confirmado'
         and a.inicio > now()) >= v_max_futuros then
    return jsonb_build_object('ok', false, 'codigo', 'limite_agendamentos',
      'mensagem', 'Você já tem agendamentos marcados. Fale com a barbearia pelo WhatsApp para marcar mais.');
  end if;

  -- Cria o agendamento; a exclusion constraint resolve corridas ---------------
  foreach v_prof_id in array v_candidatos loop
    begin
      insert into public.agendamentos
        (barbearia_id, profissional_id, servico_id, cliente_id, inicio, fim,
         status, origem, preco_cobrado)
      values
        (v_barbearia.id, v_prof_id, v_servico.id, v_cliente_id, p_inicio,
         p_inicio + make_interval(mins => v_servico.duracao_min),
         'confirmado', 'online', v_servico.preco)
      returning * into v_ag;
      exit;
    exception when exclusion_violation then
      v_ag := null;
    end;
  end loop;

  if v_ag.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'horario_indisponivel',
      'mensagem', 'Poxa, esse horário acabou de ser ocupado. Escolha outro horário.');
  end if;

  select * into v_prof from public.profissionais p where p.id = v_ag.profissional_id;

  return jsonb_build_object(
    'ok', true,
    'agendamento', jsonb_build_object(
      'id',     v_ag.id,
      'inicio', v_ag.inicio,
      'fim',    v_ag.fim,
      'data',   to_char(v_ag.inicio at time zone v_tz, 'DD/MM/YYYY'),
      'hora',   to_char(v_ag.inicio at time zone v_tz, 'HH24:MI'),
      'status', v_ag.status,
      'preco',  v_ag.preco_cobrado,
      'moeda',  'BRL'
    ),
    'barbearia', jsonb_build_object(
      'nome', v_barbearia.nome, 'slug', v_barbearia.slug,
      'whatsapp', v_barbearia.whatsapp, 'endereco', v_barbearia.endereco,
      'cidade', v_barbearia.cidade
    ),
    'servico', jsonb_build_object(
      'id', v_servico.id, 'nome', v_servico.nome,
      'preco', v_servico.preco, 'duracao_min', v_servico.duracao_min
    ),
    'profissional', jsonb_build_object(
      'id', v_prof.id, 'nome', v_prof.nome, 'foto_url', v_prof.foto_url
    ),
    'cliente', jsonb_build_object('nome', v_nome, 'telefone', v_telefone)
  );
end;
$$;

revoke execute on function public.barbearia_publica(text) from public;
revoke execute on function public.horarios_livres(text, uuid, uuid, date) from public;
revoke execute on function public.criar_agendamento_publico(text, uuid, uuid, timestamptz, text, text) from public;

grant execute on function public.barbearia_publica(text) to anon, authenticated;
grant execute on function public.horarios_livres(text, uuid, uuid, date) to anon, authenticated;
grant execute on function public.criar_agendamento_publico(text, uuid, uuid, timestamptz, text, text) to anon, authenticated;
