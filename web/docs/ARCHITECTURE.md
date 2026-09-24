# Arquitetura

## Visão geral

O produto tem três áreas, todas servidas pelo mesmo app Next.js (App Router):

1. **Site institucional** — `/` — apresentação do produto, login e cadastro.
2. **Dashboard do empresário** — `/dashboard/*` — painel autenticado, sempre
   escopado à empresa do usuário logado.
3. **Página pública de cada negócio** — `/[slug]` — vitrine + agendamento,
   sem autenticação.

```
src/app/
├── page.tsx                 # site institucional
├── login/ signup/           # autenticação (Supabase Auth)
├── auth/confirm/route.ts    # callback de confirmação de email
├── onboarding/               # criação da empresa (primeiro acesso)
├── dashboard/
│   ├── layout.tsx            # resolve a empresa do usuário logado, sidebar
│   ├── page.tsx               # visão geral
│   ├── appointments/          # agenda (lista por dia + ações de status)
│   ├── services/               # CRUD de serviços
│   ├── professionals/          # CRUD de profissionais + vínculo com serviços
│   ├── customers/               # CRUD de clientes
│   ├── hours/                    # horário de funcionamento (semanal)
│   ├── blocked-times/             # bloqueios/folgas
│   ├── customization/              # logo, capa, cores, layout
│   └── settings/                    # dados da empresa, publicação
└── [slug]/
    ├── page.tsx               # página pública (dados via RLS pública)
    └── booking-widget.tsx     # fluxo de agendamento (client component)
```

## Por que não há `/[slug]` nas rotas do dashboard

Cada usuário autenticado gerencia **uma** empresa (a modelagem já suporta
múltiplas empresas por usuário via `business_members`, mas o MVP resolve a
"empresa atual" do usuário logado no servidor, em
[`src/lib/auth.ts`](../src/lib/auth.ts) → `getCurrentBusiness()`). Isso
evita expor o id/slug da empresa na URL do dashboard e simplifica todo o
roteamento. Uma futura tela de "trocar de empresa" pode ser adicionada sem
quebrar nada, já que o schema já suporta N:N entre `profiles` e
`businesses` através de `business_members`.

## Camadas de dados

- **Server Components** fazem a maior parte das leituras, usando o cliente
  Supabase server-side (`src/lib/supabase/server.ts`), que propaga a sessão
  via cookies.
- **Server Actions** (`actions.ts` ao lado de cada página) fazem todas as
  escritas autenticadas (dashboard). Elas nunca recebem `business_id` do
  cliente: sempre re-derivam a empresa a partir da sessão
  (`getCurrentBusiness()`), e todo `.eq("business_id", business.id)` é
  redundante de propósito — é defesa em profundidade além do RLS.
- **RPCs Postgres `SECURITY DEFINER`** (`create_business`,
  `get_available_slots`, `create_public_appointment`) cobrem os únicos casos
  em que um visitante anônimo precisa escrever ou ler dados agregados sem
  ter uma linha própria em `business_members`. Veja
  [`DATABASE.md`](./DATABASE.md).
- **Row Level Security** é a fonte de verdade final para isolamento entre
  tenants — veja [`SECURITY.md`](./SECURITY.md).

## Autenticação

Supabase Auth (email + senha, com confirmação por email). O fluxo:

1. `/signup` → `supabase.auth.signUp()` → email de confirmação.
2. Link do email → `/auth/confirm` (Route Handler) → `verifyOtp()` → sessão
   criada → redireciona para `/onboarding`.
3. `/onboarding` → RPC `create_business()` cria a empresa, o vínculo de
   owner, as configurações e o tema padrão numa única transação.
4. `src/proxy.ts` (Next.js 16 renomeou `middleware.ts` → `proxy.ts`) mantém
   a sessão viva em toda navegação.

## Página pública e agendamento

A página `/[slug]` só lê dados via as policies públicas do RLS (empresa
publicada, serviços/profissionais ativos, tema, horários). O widget de
agendamento chama diretamente, do navegador, as RPCs públicas
`get_available_slots` e `create_public_appointment` — ambas
`SECURITY DEFINER`, então todo o negócio (validar que o serviço pertence à
empresa do slug, respeitar horários/bloqueios/antecedência mínima, impedir
overbooking) é resolvido no Postgres, nunca confiando em nada que o cliente
tenha enviado além do slug + ids escolhidos na UI.

## Multi-tenant, hoje e amanhã

- Hoje: 1 owner + N staff por empresa (`business_members.role`).
- Preparado para amanhã: um mesmo `user_id` pode pertencer a múltiplas
  empresas (a unique constraint é `(business_id, user_id)`, não
  `(user_id)`), e novos papéis (`gerente`, `administrador`) só exigem
  estender o `check` de `role` e as policies que hoje distinguem apenas
  `owner`/`staff`.
