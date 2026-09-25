# Deploy em produção: GitHub → Vercel → Supabase

Guia de ponta a ponta para colocar o Aureon Agenda em produção. Para rodar
localmente pela primeira vez, veja [`SETUP.md`](./SETUP.md) — este
documento assume que você já tem o projeto rodando localmente e quer
publicá-lo.

## Visão geral

```
GitHub (repositório) ──push──▶ Vercel (build + hosting do Next.js)
                                        │
                                        ▼
                              Supabase (Postgres + Auth + Storage
                                         + Edge Functions)
```

A Vercel nunca aplica migrations nem faz deploy das Edge Functions — são
dois passos manuais (ou de CI) separados contra o Supabase, descritos
abaixo. O app funciona plenamente sem Edge Functions configuradas (elas só
processam lembretes/notificações outbound); não funciona sem as migrations
aplicadas.

## 1. Supabase: projeto de produção

Use um projeto Supabase **dedicado à produção** — nunca o mesmo projeto
usado em desenvolvimento local. Em
[supabase.com/dashboard](https://supabase.com/dashboard), crie o projeto e
anote, em **Project Settings → API**: a **Project URL** e a **anon public
key**. Em **Project Settings → API → Service Role**, copie também a
**service_role key** (secreta).

### Migrations

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase db push
```

Isso aplica, em ordem, todos os arquivos em `supabase/migrations/`
(atualmente até `20250924120009_audit_hardening.sql`). Alternativa via
`psql` ou colando no SQL Editor do dashboard: veja
[`SETUP.md`](./SETUP.md#4-rodar-as-migrations).

**Nunca** rode `supabase/seed/demo.sql` contra o projeto de produção — ele
existe só para dev/staging, ver o cabeçalho do próprio arquivo. Dados
fictícios não pertencem a um ambiente que clientes reais vão acessar.

### Auth: URLs de redirect

Em **Authentication → URL Configuration**:

- **Site URL**: a URL de produção do app (ex: `https://app.seusite.com`,
  ou o domínio único se você ainda não separou os subdomínios — ver
  [`ARCHITECTURE.md`](./ARCHITECTURE.md#subdomínios)).
- **Redirect URLs**: `https://<mesmo-domínio>/auth/confirm`.

### Storage

O bucket `business-assets` (público para leitura, com limite de 5MB e
tipos MIME restritos a imagem) já é criado pela migration
`20250924120006_storage.sql` + hardening em `...0009`. Nada a configurar
manualmente aqui.

### Edge Functions (opcional — só se for usar lembretes/notificações outbound)

```bash
supabase functions deploy process-notifications
supabase functions deploy appointment-reminders
```

Configure os secrets que essas duas functions leem (nunca vão na Vercel —
ver `.env.example`, seção "SECRETS DE EDGE FUNCTIONS"):

```bash
supabase secrets set \
  CRON_SECRET=$(openssl rand -hex 32) \
  WHATSAPP_ACCESS_TOKEN=... \
  WHATSAPP_PHONE_NUMBER_ID=... \
  RESEND_API_KEY=... \
  EMAIL_FROM_ADDRESS="Aureon Agenda <agenda@seusite.com>"
```

`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente
pelo Supabase, não precisam ser definidas. Agende as duas functions via
`pg_cron` + `pg_net` (mesmo `CRON_SECRET` no header `Authorization:
Bearer ...`) — passo a passo completo em
[`NOTIFICATIONS.md`](./NOTIFICATIONS.md). Sem isso configurado, o produto
funciona normalmente — só não envia WhatsApp/e-mail (a notificação
in-app no sininho do dashboard não depende de Edge Functions).

## 2. GitHub

Nada específico do Aureon Agenda aqui além do óbvio: o repositório
precisa estar no GitHub para a Vercel importar. Se você está lendo isto
numa sessão de agente que já trabalha num branch, um `git push` normal
é suficiente — a Vercel é configurada para observar o branch de deploy
(tipicamente `main`) no passo seguinte.

## 3. Vercel

1. [vercel.com/new](https://vercel.com/new) → importe o repositório.
2. **Root Directory**: `web` (o app Next.js vive em `web/`, não na raiz do
   repositório — o restante do repo é um projeto não relacionado).
3. Framework preset: Next.js (detectado automaticamente).
4. **Environment Variables** — adicione para **Production** e **Preview**
   (Preview pode apontar para o mesmo projeto Supabase de produção ou para
   um projeto Supabase separado de staging, sua escolha):

   | Variável | Onde pegar |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
   | `NEXT_PUBLIC_SITE_URL` | a URL de produção (ex: `https://app.seusite.com`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → Service Role — **marque como Sensitive/Secret** na Vercel |
   | Billing (opcional) | ver `.env.example` — só se for usar cobrança real |
   | `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_AGENDA_URL` / `NEXT_PUBLIC_MARKETING_URL` | opcional, só ao adotar os subdomínios — ver [`ARCHITECTURE.md`](./ARCHITECTURE.md#subdomínios) |

   `NEXT_PUBLIC_*` ficam embutidas no bundle do navegador por design — não
   são segredo. Tudo o mais é server-only; a Vercel nunca expõe uma
   variável sem esse prefixo ao código do navegador.
5. Deploy.
6. Volte ao Supabase (**Authentication → URL Configuration**) e confirme
   que a Site URL/Redirect URL batem com o domínio real que a Vercel deu
   ao projeto (ou o domínio customizado, se já configurado — passo 4
   abaixo).

### Build

`npm run build` (`next build`, runtime Node — nenhuma rota usa
`export const runtime = "edge"`, e o `node:crypto` que a verificação de
assinatura de webhook usa exige Node). `package.json` declara `"engines":
{ "node": ">=20.9.0" }`, o mínimo exigido pelo Next.js 16 — a Vercel lê
isso automaticamente.

### Rotas públicas vs. privadas

Nenhuma configuração extra necessária: `src/proxy.ts` mantém a sessão viva
em toda navegação, e cada página do dashboard resolve a própria proteção
via `getCurrentBusiness()`/`requireUser()` (redireciona para `/login` sem
sessão, para `/onboarding` sem empresa) — ver
[`ARCHITECTURE.md`](./ARCHITECTURE.md#autenticação). `/`, `/login`,
`/signup`, `/[slug]` são públicas por natureza; `/dashboard/*` nunca é.

## 4. Domínio

### Domínio único (padrão, sem configuração extra)

Aponte um único domínio (ex: `app.seusite.com` ou `seusite.com`) para o
projeto Vercel (**Project Settings → Domains**) e é só isso — o app
inteiro (site institucional, dashboard, páginas públicas de agendamento)
já funciona sob um domínio só, exatamente como neste repositório hoje.

### Arquitetura de subdomínios (opcional)

O app já está preparado para separar em três subdomínios — ver
[`ARCHITECTURE.md`](./ARCHITECTURE.md#subdomínios) para o racional
completo. Para ativar:

1. Na Vercel, adicione os três domínios ao mesmo projeto (**Project
   Settings → Domains**): `app.seusite.com`, `agenda.seusite.com`,
   `www.seusite.com` (ou `seusite.com`).
2. No seu provedor de DNS, aponte os três (CNAME para `cname.vercel-dns.com`,
   ou o que a Vercel instruir na tela de cada domínio).
3. Defina as três variáveis de ambiente `NEXT_PUBLIC_APP_URL`,
   `NEXT_PUBLIC_AGENDA_URL`, `NEXT_PUBLIC_MARKETING_URL` com essas URLs.
4. Redeploy. O middleware (`src/proxy.ts` +
   `src/lib/subdomain-routing.ts`) passa a redirecionar cada host para a
   parte certa do app automaticamente: `/dashboard`, `/login`, `/signup`,
   `/onboarding` e `/auth/*` só respondem em `app.*` (redirecionando de
   volta se acessados em outro host); `/{slug}` só em `agenda.*`; `/` só
   em `www.*`. `/api/*` nunca é redirecionado (webhooks batem numa URL
   fixa).
5. Atualize a Site URL/Redirect URL no Supabase Auth para o novo
   `app.seusite.com`.

Isto é separação de domínios **da plataforma**, não domínio customizado
por cliente/tenant — cada empresa continua vivendo em
`agenda.seusite.com/{slug}`, não em um domínio próprio. Suporte a domínio
próprio por tenant não existe ainda.

## 5. Checklist pós-deploy

- [ ] `supabase db push` aplicado (ou confirmado igual ao `main`)
- [ ] Auth URL Configuration aponta para o domínio real
- [ ] Variáveis de ambiente da Vercel conferem com `.env.example`
- [ ] Testar o fluxo completo uma vez em produção: cadastro → confirmar
      email → onboarding → criar 1 serviço + 1 profissional → publicar →
      abrir a página pública → agendar como visitante → ver o
      agendamento e a notificação no dashboard
- [ ] Se for usar cobrança real: configurar o webhook do provedor
      apontando para `https://<domínio>/api/webhooks/billing/<provider>`
      (ver [`BILLING.md`](./BILLING.md))
- [ ] Se for usar lembretes por WhatsApp/e-mail: Edge Functions
      deployadas, secrets configurados, cron agendado (ver
      [`NOTIFICATIONS.md`](./NOTIFICATIONS.md))
- [ ] **Não** rodar `supabase/seed/demo.sql` contra este projeto

## Observabilidade

- **Logs de aplicação**: Vercel captura `stdout`/`stderr` automaticamente
  (Project → Logs / Observability). Server actions e route handlers usam
  `src/lib/logger.ts` (`logError`) para logar erros de banco/API de forma
  estruturada e sem dados sensíveis — ver o comentário no topo do arquivo
  para a garantia de que nunca loga PII de cliente.
- **Logs de Edge Functions**: Supabase Dashboard → Edge Functions → cada
  function → Logs.
- **Erros de renderização não tratados**: `src/app/error.tsx` (site
  público/institucional), `src/app/dashboard/error.tsx` (painel) e
  `src/app/global-error.tsx` (último recurso) mostram uma tela amigável
  em vez da tela de erro padrão do Next.js — o erro em si só é logado no
  console do navegador de quem o encontrou (são Client Components, é uma
  limitação de React), não no servidor. Para capturar isso também no
  servidor, o próximo passo natural é um serviço de error tracking
  (Sentry ou similar) — não configurado neste repositório.
- **Falhas de notificação**: cada tentativa de envio grava
  `notification_deliveries.status`/`last_error`, visível também no
  dashboard (`/dashboard/notifications`) — não é preciso ler logs para
  saber se um WhatsApp/e-mail falhou.

## Rollback

A Vercel mantém todo deploy anterior: **Deployments** → escolha um deploy
antigo → **Promote to Production**. Isso não reverte migrations de banco
— uma migration já aplicada via `supabase db push` fica aplicada; se uma
migration precisar ser desfeita, escreva uma nova migration que reverte a
mudança (nunca edite um arquivo de migration já commitado/aplicado).
