# Aureon Agenda

SaaS multiempresa de agendamentos para negócios baseados em horário —
barbearias, salões, manicure, estética, tatuagem, massagem, personal
trainers e afins. Cada empresa (tenant) tem sua própria conta, equipe,
serviços, profissionais, horários e uma página pública para receber
agendamentos de clientes.

> Este app vive em `/web` dentro do repositório `aureon-api`. O restante do
> repositório (`server.js`, `TraderAureonia_Slave.mq5`) é um projeto
> completamente separado (um servidor de sinais de trading) e não é afetado
> por nada aqui.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack, TypeScript)
- [Tailwind CSS 4](https://tailwindcss.com)
- [Supabase](https://supabase.com) — Postgres, Auth, Storage, Row Level
  Security
- [Zod](https://zod.dev) para validação de formulários e server actions
- [Vitest](https://vitest.dev) + Testing Library

## Arquitetura em uma frase

Multi-tenant real: cada empresa é isolada por Row Level Security no banco
(não apenas no frontend) — veja [`docs/SECURITY.md`](./docs/SECURITY.md) e
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Instalação

```bash
cd web
npm install
```

## Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Copie `.env.example` para `.env.local` e preencha com as credenciais do
   projeto (Project Settings → API):

   ```bash
   cp .env.example .env.local
   ```

3. Rode as migrations (veja [`docs/SETUP.md`](./docs/SETUP.md) para o passo
   a passo completo, incluindo via Supabase CLI ou `psql` direto):

   ```bash
   supabase link --project-ref <seu-project-ref>
   supabase db push
   ```

## Rodando localmente

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

- `/` — site institucional
- `/signup`, `/login` — cadastro e login do empresário
- `/onboarding` — criação da empresa (primeiro acesso)
- `/dashboard` — visão geral (métricas do dia, ocupação, próximos agendamentos)
- `/dashboard/agenda` — calendário por dia/semana/mês, com filtro por profissional
- `/dashboard/appointments` — lista de agendamentos com filtros e busca;
  `/dashboard/appointments/[id]` é o detalhe (confirmar, concluir, cancelar,
  marcar não compareceu, reagendar)
- `/dashboard/services`, `/dashboard/professionals` — CRUD + ativar/desativar;
  serviços podem ser reordenados, profissionais têm link para ver a própria agenda
- `/dashboard/customers` — lista com histórico resumido;
  `/dashboard/customers/[id]` é o histórico completo do cliente
- `/dashboard/hours`, `/dashboard/blocked-times`, `/dashboard/customization`,
  `/dashboard/settings` — horários, bloqueios, personalização da página
  pública e configurações da empresa
- `/{slug-da-empresa}` — página pública de agendamento de cada empresa

Quando um cliente agenda, cancela ou reagenda, o empresário é avisado no
sininho do dashboard na hora, e por WhatsApp/e-mail quando configurado em
`/dashboard/settings` — veja [`docs/NOTIFICATIONS.md`](./docs/NOTIFICATIONS.md).

## Scripts

| Script                 | Descrição                                |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Servidor de desenvolvimento (Turbopack)  |
| `npm run build`        | Build de produção                        |
| `npm run start`        | Serve o build de produção                |
| `npm run lint`         | ESLint                                   |
| `npm run lint:fix`     | ESLint com correção automática           |
| `npm run typecheck`    | Checagem de tipos (`tsc --noEmit`)       |
| `npm run test`         | Roda os testes (Vitest)                  |
| `npm run test:watch`   | Testes em modo watch                     |
| `npm run format`       | Formata com Prettier                     |
| `npm run format:check` | Verifica formatação sem alterar arquivos |

## Deploy (Vercel)

1. Importe o repositório na Vercel, apontando o **Root Directory** para
   `web`.
2. Configure as mesmas variáveis de `.env.example` em
   Project Settings → Environment Variables.
3. Deploy. As migrations do Supabase são aplicadas separadamente (via
   Supabase CLI/dashboard), não fazem parte do build da Vercel.

## Documentação

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — visão geral do produto e das rotas
- [`docs/DATABASE.md`](./docs/DATABASE.md) — schema, relacionamentos, RPCs
- [`docs/SECURITY.md`](./docs/SECURITY.md) — modelo de multi-tenancy e RLS
- [`docs/SETUP.md`](./docs/SETUP.md) — passo a passo de configuração local e deploy
- [`docs/NOTIFICATIONS.md`](./docs/NOTIFICATIONS.md) — arquitetura de notificações (in-app/e-mail/WhatsApp), onde colocar credenciais, cron dos lembretes
