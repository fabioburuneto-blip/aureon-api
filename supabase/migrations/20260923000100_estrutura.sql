-- =============================================================================
-- SaaS Barbearias — 1/4: estrutura (tabelas, constraints, triggers, seed)
-- Fuso: America/Sao_Paulo · Moeda: BRL
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- Schema interno (não exposto pela API do Supabase) para funções auxiliares.
create schema if not exists private;

-- Fuso horário padrão do banco. Todas as funções também convertem explicitamente
-- para America/Sao_Paulo, então isso é só conveniência para consultas manuais.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Sao_Paulo');
exception when insufficient_privilege then
  raise notice 'Sem permissão para alterar o timezone do banco; as funções já usam America/Sao_Paulo explicitamente.';
end $$;

-- -----------------------------------------------------------------------------
-- Tema (identidade visual)
-- -----------------------------------------------------------------------------
create or replace function private.tema_padrao()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'layout',         'luxo',
    'cor_primaria',   '#1A1A1A',
    'cor_destaque',   '#C9A24D',
    'cor_fundo',      '#0E0E0E',
    'cor_texto',      '#F5F1E8',
    'par_fontes',     'elegante',
    'logo_url',       '',
    'foto_capa_url',  '',
    'galeria',        '[]'::jsonb,
    'titulo_hero',    '',
    'subtitulo_hero', '',
    'texto_sobre',    ''
  );
$$;

create or replace function private.tema_valido(t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
        jsonb_typeof(t) = 'object'
    and t->>'layout'     in ('classico', 'urbano', 'luxo', 'minimalista')
    and t->>'par_fontes' in ('elegante', 'moderna', 'classica', 'impacto')
    and t->>'cor_primaria' ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'
    and t->>'cor_destaque' ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'
    and t->>'cor_fundo'    ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'
    and t->>'cor_texto'    ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$'
    and jsonb_typeof(t->'logo_url')       = 'string'
    and jsonb_typeof(t->'foto_capa_url')  = 'string'
    and jsonb_typeof(t->'titulo_hero')    = 'string'
    and jsonb_typeof(t->'subtitulo_hero') = 'string'
    and jsonb_typeof(t->'texto_sobre')    = 'string'
    and jsonb_typeof(t->'galeria')        = 'array',
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- 1. barbearias
-- -----------------------------------------------------------------------------
create table public.barbearias (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  nome                  text not null,
  whatsapp              text,
  endereco              text,
  cidade                text,
  instagram             text,
  -- Informativo para o site. Chaves "0".."6" (0 = domingo).
  -- A agenda real vem da tabela disponibilidade.
  horario_funcionamento jsonb not null default '{
    "0": {"aberto": false, "abre": null,    "fecha": null},
    "1": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
    "2": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
    "3": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
    "4": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
    "5": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
    "6": {"aberto": true,  "abre": "09:00", "fecha": "17:00"}
  }'::jsonb,
  tema                  jsonb not null default private.tema_padrao(),
  ativo                 boolean not null default true,
  created_at            timestamptz not null default now(),

  constraint barbearias_slug_formato check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 60),
  constraint barbearias_nome_preenchido check (length(btrim(nome)) > 0),
  constraint barbearias_horario_objeto check (jsonb_typeof(horario_funcionamento) = 'object'),
  constraint barbearias_tema_valido check (private.tema_valido(tema))
);

comment on column public.barbearias.slug is 'Identificador na URL: minúsculo, sem espaços, apenas letras, números e hífens.';
comment on column public.barbearias.tema is 'Identidade visual. Chaves ausentes são preenchidas com o tema padrão.';

-- Normaliza slug e completa o tema com os valores padrão (merge raso).
create or replace function private.barbearias_normalizar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.slug := lower(btrim(new.slug));
  new.tema := private.tema_padrao() || coalesce(new.tema, '{}'::jsonb);
  return new;
end;
$$;

create trigger barbearias_normalizar
  before insert or update on public.barbearias
  for each row execute function private.barbearias_normalizar();

-- -----------------------------------------------------------------------------
-- 2. perfis
-- -----------------------------------------------------------------------------
create table public.perfis (
  id           uuid primary key references auth.users (id) on delete cascade,
  barbearia_id uuid references public.barbearias (id) on delete cascade,
  nome         text not null,
  papel        text not null,

  constraint perfis_papel_valido check (papel in ('superadmin', 'dono', 'barbeiro')),
  -- dono e barbeiro sempre pertencem a uma barbearia
  constraint perfis_barbearia_obrigatoria check (papel = 'superadmin' or barbearia_id is not null)
);

create index perfis_barbearia_idx on public.perfis (barbearia_id);

-- -----------------------------------------------------------------------------
-- 3. profissionais
-- -----------------------------------------------------------------------------
create table public.profissionais (
  id           uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias (id) on delete cascade,
  nome         text not null,
  foto_url     text,
  ativo        boolean not null default true,
  ordem        integer not null default 0,

  constraint profissionais_nome_preenchido check (length(btrim(nome)) > 0),
  -- permite FKs compostas que garantem que filhos são da mesma barbearia
  constraint profissionais_id_barbearia_key unique (id, barbearia_id)
);

create index profissionais_barbearia_idx on public.profissionais (barbearia_id, ordem);

-- -----------------------------------------------------------------------------
-- 4. servicos
-- -----------------------------------------------------------------------------
create table public.servicos (
  id           uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias (id) on delete cascade,
  nome         text not null,
  descricao    text,
  preco        numeric(10, 2) not null default 0,
  duracao_min  integer not null,
  ativo        boolean not null default true,
  ordem        integer not null default 0,

  constraint servicos_nome_preenchido check (length(btrim(nome)) > 0),
  constraint servicos_preco_positivo check (preco >= 0),
  constraint servicos_duracao_valida check (duracao_min > 0 and duracao_min <= 720),
  constraint servicos_id_barbearia_key unique (id, barbearia_id)
);

comment on column public.servicos.preco is 'Valor em BRL.';

create index servicos_barbearia_idx on public.servicos (barbearia_id, ordem);

-- -----------------------------------------------------------------------------
-- 5. catalogo_servicos_padrao (global)
-- -----------------------------------------------------------------------------
create table public.catalogo_servicos_padrao (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null unique,
  duracao_min_sugerida integer not null check (duracao_min_sugerida > 0)
);

insert into public.catalogo_servicos_padrao (nome, duracao_min_sugerida) values
  ('Corte',          30),
  ('Barba',          30),
  ('Corte + Barba',  60),
  ('Sobrancelha',    15),
  ('Pezinho',        15),
  ('Pigmentação',    30),
  ('Hidratação',     30),
  ('Luzes',          90),
  ('Platinado',     120),
  ('Corte infantil', 30)
on conflict (nome) do nothing;

-- -----------------------------------------------------------------------------
-- 6. disponibilidade (grade semanal de cada profissional)
-- -----------------------------------------------------------------------------
create table public.disponibilidade (
  id              uuid primary key default gen_random_uuid(),
  barbearia_id    uuid not null references public.barbearias (id) on delete cascade,
  profissional_id uuid not null,
  dia_semana      smallint not null,
  hora_inicio     time not null,
  hora_fim        time not null,

  constraint disponibilidade_dia_valido check (dia_semana between 0 and 6),
  constraint disponibilidade_intervalo_valido check (hora_fim > hora_inicio),
  constraint disponibilidade_profissional_fk foreign key (profissional_id, barbearia_id)
    references public.profissionais (id, barbearia_id) on delete cascade
);

comment on column public.disponibilidade.dia_semana is '0 = domingo, 1 = segunda, ..., 6 = sábado. Vários intervalos por dia são permitidos (ex.: pausa para almoço).';

create index disponibilidade_prof_dia_idx on public.disponibilidade (profissional_id, dia_semana);
create index disponibilidade_barbearia_idx on public.disponibilidade (barbearia_id);

-- -----------------------------------------------------------------------------
-- 7. bloqueios
-- -----------------------------------------------------------------------------
create table public.bloqueios (
  id              uuid primary key default gen_random_uuid(),
  barbearia_id    uuid not null references public.barbearias (id) on delete cascade,
  -- nulo = bloqueio da barbearia inteira (feriado, reforma etc.)
  profissional_id uuid,
  inicio          timestamptz not null,
  fim             timestamptz not null,
  motivo          text,

  constraint bloqueios_intervalo_valido check (fim > inicio),
  constraint bloqueios_profissional_fk foreign key (profissional_id, barbearia_id)
    references public.profissionais (id, barbearia_id) on delete cascade
);

comment on column public.bloqueios.profissional_id is 'Nulo = bloqueia todos os profissionais da barbearia.';

create index bloqueios_barbearia_periodo_idx on public.bloqueios using gist (barbearia_id, tstzrange(inicio, fim, '[)'));

-- -----------------------------------------------------------------------------
-- 8. clientes
-- -----------------------------------------------------------------------------
create table public.clientes (
  id           uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias (id) on delete cascade,
  nome         text not null,
  telefone     text not null,

  constraint clientes_nome_preenchido check (length(btrim(nome)) > 0),
  constraint clientes_telefone_formato check (telefone ~ '^[0-9]{10,13}$'),
  constraint clientes_barbearia_telefone_key unique (barbearia_id, telefone),
  constraint clientes_id_barbearia_key unique (id, barbearia_id)
);

comment on column public.clientes.telefone is 'Somente dígitos (DDD + número, opcionalmente com 55). Normalizado automaticamente.';

create or replace function private.clientes_normalizar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome := btrim(new.nome);
  new.telefone := regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g');
  return new;
end;
$$;

create trigger clientes_normalizar
  before insert or update on public.clientes
  for each row execute function private.clientes_normalizar();

-- -----------------------------------------------------------------------------
-- 9. agendamentos
-- -----------------------------------------------------------------------------
create table public.agendamentos (
  id              uuid primary key default gen_random_uuid(),
  barbearia_id    uuid not null references public.barbearias (id) on delete cascade,
  profissional_id uuid not null,
  servico_id      uuid not null,
  cliente_id      uuid not null,
  inicio          timestamptz not null,
  fim             timestamptz not null,
  status          text not null default 'confirmado',
  origem          text not null default 'manual',
  preco_cobrado   numeric(10, 2),
  observacao      text,
  created_at      timestamptz not null default now(),

  constraint agendamentos_status_valido check (status in ('confirmado', 'concluido', 'cancelado', 'faltou')),
  constraint agendamentos_origem_valida check (origem in ('online', 'manual')),
  constraint agendamentos_intervalo_valido check (fim > inicio),
  constraint agendamentos_preco_positivo check (preco_cobrado is null or preco_cobrado >= 0),

  -- FKs compostas: profissional, serviço e cliente precisam ser da MESMA barbearia
  constraint agendamentos_profissional_fk foreign key (profissional_id, barbearia_id)
    references public.profissionais (id, barbearia_id) on delete restrict,
  constraint agendamentos_servico_fk foreign key (servico_id, barbearia_id)
    references public.servicos (id, barbearia_id) on delete restrict,
  constraint agendamentos_cliente_fk foreign key (cliente_id, barbearia_id)
    references public.clientes (id, barbearia_id) on delete restrict,

  -- Impede dois agendamentos sobrepostos para o mesmo profissional
  -- (agendamentos cancelados não ocupam horário).
  constraint agendamentos_sem_sobreposicao exclude using gist (
    profissional_id with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status <> 'cancelado')
);

comment on column public.agendamentos.preco_cobrado is 'Valor em BRL. Se omitido no insert, recebe o preço atual do serviço.';

create index agendamentos_barbearia_inicio_idx on public.agendamentos (barbearia_id, inicio);
create index agendamentos_cliente_idx on public.agendamentos (cliente_id);
create index agendamentos_servico_idx on public.agendamentos (servico_id);

-- Preenche fim (pela duração do serviço) e preco_cobrado quando não informados.
create or replace function private.agendamentos_preencher()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_duracao integer;
  v_preco   numeric;
begin
  if new.fim is null or (tg_op = 'INSERT' and new.preco_cobrado is null) then
    select s.duracao_min, s.preco
      into v_duracao, v_preco
      from public.servicos s
     where s.id = new.servico_id
       and s.barbearia_id = new.barbearia_id;

    if new.fim is null and v_duracao is not null then
      new.fim := new.inicio + make_interval(mins => v_duracao);
    end if;

    if tg_op = 'INSERT' and new.preco_cobrado is null then
      new.preco_cobrado := v_preco;
    end if;
  end if;
  return new;
end;
$$;

create trigger agendamentos_preencher
  before insert or update on public.agendamentos
  for each row execute function private.agendamentos_preencher();
