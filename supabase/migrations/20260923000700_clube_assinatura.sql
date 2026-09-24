-- =============================================================================
-- SaaS Barbearias — 7: clube de assinatura (planos, assinantes, split Asaas)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. planos_clube — o que o dono oferece (ex.: "Corte ilimitado", R$ 99/mês)
-- -----------------------------------------------------------------------------
create table public.planos_clube (
  id            uuid primary key default gen_random_uuid(),
  barbearia_id  uuid not null references public.barbearias (id) on delete cascade,
  nome          text not null,
  descricao     text,
  preco         numeric(10, 2) not null,
  creditos_mes  integer not null,
  ativo         boolean not null default true,
  ordem         integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint planos_clube_nome_preenchido check (length(btrim(nome)) > 0),
  constraint planos_clube_preco_positivo check (preco > 0),
  constraint planos_clube_creditos_positivo check (creditos_mes > 0),
  constraint planos_clube_id_barbearia_key unique (id, barbearia_id)
);

comment on column public.planos_clube.creditos_mes is 'Quantos agendamentos o plano cobre por ciclo de cobrança.';

create index planos_clube_barbearia_idx on public.planos_clube (barbearia_id, ordem);

-- -----------------------------------------------------------------------------
-- 2. assinaturas_clube — vínculo cliente + plano, espelhando a assinatura Asaas
-- -----------------------------------------------------------------------------
create table public.assinaturas_clube (
  id                    uuid primary key default gen_random_uuid(),
  barbearia_id          uuid not null references public.barbearias (id) on delete cascade,
  cliente_id            uuid not null,
  plano_id              uuid not null,
  status                text not null default 'pendente',
  asaas_customer_id     text,
  asaas_subscription_id text unique,
  ciclo_inicio          date,
  ciclo_fim             date,
  creditos_usados_ciclo integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint assinaturas_clube_status_valido check (status in ('pendente', 'ativa', 'atrasada', 'cancelada')),
  constraint assinaturas_clube_creditos_positivo check (creditos_usados_ciclo >= 0),
  constraint assinaturas_clube_cliente_fk foreign key (cliente_id, barbearia_id)
    references public.clientes (id, barbearia_id) on delete cascade,
  constraint assinaturas_clube_plano_fk foreign key (plano_id, barbearia_id)
    references public.planos_clube (id, barbearia_id) on delete restrict,
  -- um cliente tem no máximo uma assinatura ativa/pendente/atrasada por barbearia
  constraint assinaturas_clube_cliente_unica unique (barbearia_id, cliente_id)
);

comment on column public.assinaturas_clube.status is 'pendente = aguardando 1º pagamento; ativa = em dia; atrasada = bloqueia benefício; cancelada = fim.';
comment on column public.assinaturas_clube.creditos_usados_ciclo is 'Zerado a cada cobrança confirmada (novo ciclo).';

create index assinaturas_clube_barbearia_idx on public.assinaturas_clube (barbearia_id);
create index assinaturas_clube_cliente_idx on public.assinaturas_clube (cliente_id);

create or replace function private.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger assinaturas_clube_updated_at
  before update on public.assinaturas_clube
  for each row execute function private.tocar_updated_at();

-- -----------------------------------------------------------------------------
-- 3. configuracao_pagamento — wallet Asaas da barbearia, para o split de valores
-- -----------------------------------------------------------------------------
create table public.configuracao_pagamento (
  barbearia_id     uuid primary key references public.barbearias (id) on delete cascade,
  asaas_wallet_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.configuracao_pagamento is 'Wallet do Asaas para onde vai o valor do plano via split. Nunca exposta ao anon.';

create trigger configuracao_pagamento_updated_at
  before update on public.configuracao_pagamento
  for each row execute function private.tocar_updated_at();

-- -----------------------------------------------------------------------------
-- 4. agendamentos: liga o agendamento à assinatura que pagou por ele
-- -----------------------------------------------------------------------------
alter table public.agendamentos
  add column assinatura_id uuid references public.assinaturas_clube (id) on delete set null;

comment on column public.agendamentos.assinatura_id is 'Preenchido quando o agendamento consumiu um crédito do clube em vez de ser cobrado à parte.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.planos_clube          enable row level security;
alter table public.assinaturas_clube     enable row level security;
alter table public.configuracao_pagamento enable row level security;

revoke all on public.planos_clube, public.assinaturas_clube, public.configuracao_pagamento
  from anon, authenticated;

grant select, insert, update, delete on public.planos_clube, public.assinaturas_clube to authenticated;
grant select, insert, update on public.configuracao_pagamento to authenticated;
grant select on public.planos_clube to anon;

create policy "planos_clube: equipe da barbearia gerencia"
  on public.planos_clube for all to authenticated
  using ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()))
  with check ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()));

create policy "planos_clube: publico le ativos"
  on public.planos_clube for select to anon
  using (ativo and private.barbearia_ativa(barbearia_id));

create policy "assinaturas_clube: equipe da barbearia gerencia"
  on public.assinaturas_clube for all to authenticated
  using ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()))
  with check ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()));

-- Só o dono (não o barbeiro) mexe na conta de recebimento da barbearia.
create policy "configuracao_pagamento: dono le e edita"
  on public.configuracao_pagamento for all to authenticated
  using ((select private.is_superadmin())
         or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id())))
  with check ((select private.is_superadmin())
         or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id())));
