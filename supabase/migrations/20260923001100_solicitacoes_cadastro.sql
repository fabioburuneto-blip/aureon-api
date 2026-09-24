-- =============================================================================
-- SaaS Barbearias — 11: onboarding self-service (etapa 1: captar o interesse)
--
-- O barbeiro preenche um formulário público (/comecar) em vez de mandar os dados
-- pelo WhatsApp. O superadmin aprova em um clique em /admin/solicitacoes, que
-- cria a barbearia e o usuário do dono — a montagem (tema, fotos) continua
-- manual, como hoje.
-- =============================================================================

create table public.solicitacoes_cadastro (
  id                uuid primary key default gen_random_uuid(),
  nome_barbearia    text not null,
  slug_desejado     text,
  nome_responsavel  text not null,
  email             text not null,
  whatsapp          text not null,
  observacao        text,
  status            text not null default 'pendente',
  created_at        timestamptz not null default now(),

  constraint solicitacoes_nome_barbearia_preenchido check (length(btrim(nome_barbearia)) > 0),
  constraint solicitacoes_nome_responsavel_preenchido check (length(btrim(nome_responsavel)) > 0),
  constraint solicitacoes_email_formato check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  constraint solicitacoes_whatsapp_formato check (whatsapp ~ '^[0-9]{10,13}$'),
  constraint solicitacoes_status_valido check (status in ('pendente', 'aprovada', 'recusada'))
);

comment on table public.solicitacoes_cadastro is 'Pedidos de cadastro vindos do formulário público /comecar, aguardando aprovação do superadmin.';

-- Evita reenvio em massa do mesmo e-mail enquanto o pedido ainda não foi tratado.
create unique index solicitacoes_cadastro_email_pendente_key
  on public.solicitacoes_cadastro (lower(email))
  where status = 'pendente';

create index solicitacoes_cadastro_status_idx on public.solicitacoes_cadastro (status, created_at);

alter table public.solicitacoes_cadastro enable row level security;

revoke all on public.solicitacoes_cadastro from anon, authenticated;

-- Qualquer visitante pode enviar um pedido (só como "pendente").
grant insert on public.solicitacoes_cadastro to anon;
create policy "solicitacoes_cadastro: qualquer um envia"
  on public.solicitacoes_cadastro for insert to anon
  with check (status = 'pendente');

-- Só o superadmin lê, aprova ou recusa.
grant select, update, delete on public.solicitacoes_cadastro to authenticated;
create policy "solicitacoes_cadastro: superadmin gerencia"
  on public.solicitacoes_cadastro for all to authenticated
  using ((select private.is_superadmin()))
  with check ((select private.is_superadmin()));

-- -----------------------------------------------------------------------------
-- "/comecar" agora é rota do sistema (formulário público de onboarding).
-- -----------------------------------------------------------------------------
alter table public.barbearias drop constraint barbearias_slug_reservado;
alter table public.barbearias
  add constraint barbearias_slug_reservado check (
    slug not in ('entrar', 'sair', 'login', 'logout', 'painel', 'admin', 'api', 'auth',
                 'app', 'www', 'static', 'public', 'assets', 'demo-admin', 'suporte', 'ajuda',
                 'comecar')
  );
