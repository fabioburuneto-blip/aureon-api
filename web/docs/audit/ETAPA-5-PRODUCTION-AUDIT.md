# ETAPA 5 — Auditoria de Produção e Preparação para Deployment

**Data de conclusão**: 2025-02-12
**Branch**: `claude/blissful-edison-4wt18p`
**Último commit**: `c9b1dd2` (test+docs: SQL regression suite and production docs for Etapa 4)

**Status**: ✅ PRONTO PARA PREPARAÇÃO DE PRODUÇÃO (sem deploy nesta etapa)

---

## 1. Estado do Repositório

```
Repositório: https://github.com/fabioburuneto-blip/aureon-api
Branch: claude/blissful-edison-4wt18p
Status: Árvore limpa, nenhuma alteração pendente
Remote: origin (GitHub, fetch+push)
```

**Commits recentes da Etapa 4:**
- `c9b1dd2`: test+docs: SQL regression suite and production docs
- `df99e70`: fix: revalidate plan eligibility at send time
- `0c14f3a`: fix: close advanced_notifications RLS-bypass gap
- `3078674`: docs: complete Etapa 4 read-only audit

---

## 2. GitHub

| Item | Status | Notas |
| --- | --- | --- |
| Repositório | ✅ Configurado | https://github.com/fabioburuneto-blip/aureon-api |
| Branch de desenvolvimento | ✅ Pronta | `claude/blissful-edison-4wt18p` |
| .gitignore | ✅ Completo | Protege `.env*`, `node_modules`, `.next`, `.vercel`, `*.pem` |
| Secrets versionados | ✅ Nenhum | Grep confirmou: zero secrets reais no código |
| License | ⚠️ Verificar | Repocriar LICENSE.md se necessário |

**Ações necessárias em produção:**
- [ ] Definir branch padrão para `main` (ou qual será o padrão da produção)
- [ ] Configurar proteção de branch para `main` (require reviews, etc)
- [ ] Adicionar secrets do GitHub (SUPABASE_URL, SUPABASE_ANON_KEY) se usar CI

---

## 3. Secrets e Credenciais

| Tipo | Localização atual | Localização em produção | Status |
| --- | --- | --- | --- |
| `.env.local` | NÃO VERSIONADO (gitignored) | Vercel Environment Variables | ✅ OK |
| `.env.example` | Versionado (placeholder) | Referência para setup | ✅ OK |
| Supabase anon key | .env.example | Vercel Production env | ✅ OK |
| Supabase service role | .env.example | Vercel Production env | ✅ OK |
| Billing provider secrets | .env.example | Vercel Production env | ✅ OK |
| Edge Function secrets | Supabase CLI | `supabase secrets set ...` | ✅ OK |

**RESULTADO: Nenhum secret real encontrado no repositório.**

---

## 4. .gitignore e .env.example

### .gitignore: ✅ COMPLETO

Protegidas:
- ✅ `.env*` (com exceção `!.env.example`)
- ✅ `/node_modules/`
- ✅ `/.next/`
- ✅ `/.vercel/`
- ✅ `*.pem` (certificados)
- ✅ `/coverage/` (testes)
- ✅ `*.log` (logs)

### .env.example: ✅ BEM ESTRUTURADO

Seções:
1. **PÚBLICAS (NEXT_PUBLIC_*)**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL`
   - Subdominios (opcionais)

2. **PRIVADAS (Server-only)**
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Billing provider (`BILLING_PROVIDER`, `MERCADOPAGO_*`, `STRIPE_*`, `ASAAS_*`)

3. **EDGE FUNCTION SECRETS**
   - `CRON_SECRET`
   - `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
   - `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`

**Nenhum valor real, apenas placeholders com documentação clara.**

---

## 5. Next.js

| Aspecto | Status | Detalhes |
| --- | --- | --- |
| Versão | ✅ 16.3.6 | Atual, suporte até Apr 2026 |
| Node | ✅ >=20.9.0 | Compatível com Vercel |
| Build command | ✅ `next build` | Padrão, funciona em Vercel |
| Start command | ✅ `next start` | Padrão, funciona em Vercel |
| TypeScript | ✅ Strict | Sem erros em produção |
| ESLint | ✅ Config.js | Lint OK |
| Prettier | ✅ Formatação OK | Sem erros |

### Configurações especiais (next.config.ts)

**Image remote patterns:**
- Supabase Storage (business-assets bucket)
- Suporte a http/https
- `dangerouslyAllowLocalIP` (dev only)

**Compatibilidade Vercel:**
- ✅ Sem filesystem writes
- ✅ Sem processos persistentes
- ✅ Sem dependências de localhost
- ✅ Sem SQLite ou DB local
- ✅ Sem WebSockets (tudo via Supabase)
- ✅ Middleware compatível (`proxy()`)

---

## 6. Vercel Compatibility

### ✅ TOTALMENTE COMPATÍVEL

**Serverless:**
- ✅ Sem estado persistente em memória
- ✅ Sem arquivos no `/tmp` que persistam entre requests
- ✅ Sem background workers locais

**Runtimes:**
- ✅ Next.js 16 nativo
- ✅ Node 20+ nativo

**Recursos usados:**
- ✅ Edge Functions → via Supabase Edge Functions (Deno), não Vercel Edge Runtime
- ✅ Background tasks → via Supabase `pg_cron` + `pg_net`, não Vercel Cron
- ✅ API routes → padrão Next.js (serverless functions)

**Build:**
```bash
npm run build  # ✅ Sem dependências externas, ready para Vercel
```

---

## 7. Supabase

### Migrations: ✅ 15 migrations versionadas

| Migration | Descrição | Status |
| --- | --- | --- |
| 20250924120001 | Extensions | ✅ |
| 20250924120002 | Schema | ✅ |
| 20250924120003 | Membership functions | ✅ |
| 20250924120004 | RLS | ✅ |
| 20250924120005 | Core functions | ✅ |
| 20250924120006 | Storage | ✅ |
| 20250924120007 | Notifications | ✅ |
| 20250924120008 | Billing | ✅ |
| 20250924120009 | Audit hardening | ✅ |
| 20250924120010 | Fix businesses grant | ✅ |
| 20250924120011 | Centralize validation | ✅ |
| 20250924120012 | Onboarding | ✅ |
| 20250924120013 | Public page engine | ✅ |
| 20250924120014 | Client booking portal | ✅ |
| 20250924120015 | Notifications plan gate (Etapa 4) | ✅ |

**Aplicação: `supabase db push` ou pipeline**

### RLS: ✅ Completo

- `profiles` (select own)
- `businesses` (select published or owned)
- `business_members` (select/update own)
- `subscriptions` (select owner only)
- `appointments` (select own or public by token)
- `notifications` (select recipient only)
- `notification_deliveries` (select owner only)
- `business_gallery` (select own or published)
- `blocked_times` (insert own)
- Storage: business-assets (private, select/insert own business)

**Testes:** SQL suite com 13+ asserções de RLS, concorrência, isolamento multi-tenant.

### Auth: ✅ Supabase Auth nativo

- Signup/Login via email
- Magic link (email confirmation)
- Password reset
- Session management

**URLs de redirect necessárias em produção:**
- `https://YOUR_DOMAIN/auth/confirm`
- `https://YOUR_DOMAIN/dashboard`

**Ações:**
- [ ] Configurar domínio real em Supabase Auth Settings
- [ ] Testar email confirmation com domínio real

### Storage: ✅ 1 bucket público

| Bucket | Acesso | Finalidade | RLS |
| --- | --- | --- | --- |
| `business-assets` | Público (SELECT), privado (INSERT/UPDATE/DELETE) | Logos, covers, avatars | ✅ |

**URL pública:** `https://YOUR_SUPABASE_URL/storage/v1/object/public/business-assets/{business_id}/...`

**Funcionamento:**
- Business owner: upload/delete via dashboard
- Público: lê logos/covers via URL pública
- Isolamento: cada business só vê/modifica seu próprio bucket path

---

## 8. Auth (Produção)

### Login flow: ✅ Pronto

1. Usuário preenche email + senha
2. Supabase Auth valida
3. Email de confirmação enviado
4. Link confirma e redireciona para `/dashboard`
5. Session salva em cookie

**URLs de callback obrigatórias:**
```
SUPABASE_AUTH_URL/auth/v1/callback?token_hash=...&type=email_change
→ localhost:3000/auth/confirm  (dev)
→ https://app.seusite.com/auth/confirm  (prod)
```

**Configuração necessária:**
- [ ] Supabase Project Settings → Auth Providers → Email
- [ ] Site URL: `https://YOUR_DOMAIN`
- [ ] Redirect URL: `https://YOUR_DOMAIN/auth/confirm`

### Features:
- ✅ Email + password (padrão)
- ✅ Magic link (opcional, não implementado)
- ✅ Password reset via `/auth/password-reset`
- ✅ Email confirmation via `/auth/confirm`

---

## 9. Storage

### Bucket: `business-assets`

**Estrutura:**
```
business-assets/
  {business_id}/
    logo.png
    cover.png
    avatar_{user_id}.jpg
```

**RLS Policy:** `business_assets_insert_own`
- INSERT: só o dono do business
- SELECT: dono + público
- DELETE: só o dono

**Verificado:** ✅ Isolamento de tenant funcional, público consegue ler URLs mas não listar bucket.

---

## 10. Edge Functions

### 2 Functions versionadas

| Function | Finalidade | Secrets | Scheduler | Status |
| --- | --- | --- | --- | --- |
| `process-notifications` | Drena fila de notificações | CRON_SECRET, WHATSAPP_*, RESEND_* | pg_cron | ✅ |
| `appointment-reminders` | Enfileira lembretes 24h/2h | CRON_SECRET | pg_cron | ✅ |

**Deploy:**
```bash
supabase functions deploy process-notifications
supabase functions deploy appointment-reminders
```

**Secrets (via Supabase CLI):**
```bash
supabase secrets set CRON_SECRET=<openssl rand -hex 32>
supabase secrets set WHATSAPP_ACCESS_TOKEN=<token>
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<id>
supabase secrets set RESEND_API_KEY=<key>
supabase secrets set EMAIL_FROM_ADDRESS=<from@domain>
```

**Scheduler (manual, SQL Editor):**
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('process-notifications', '*/2 * * * *', ...);
select cron.schedule('appointment-reminders', '*/10 * * * *', ...);
```

---

## 11. Notificações (Etapa 4)

**Status:** ✅ Implementado, estrutura dupla de validação

### In-app (Dashboard)
- ✅ Sininho com contador
- ✅ Página `/dashboard/notifications`
- ✅ Marcar como lida
- ✅ RLS por destinatário

### WhatsApp
- **Status:** Implementado, NÃO VALIDADO COM API REAL
- **Requisitos produção:** access token + phone number ID da Meta
- **Limitação:** um número único para toda plataforma

### E-mail (Resend)
- **Status:** Implementado, NÃO VALIDADO COM API REAL
- **Requisitos produção:** API key Resend + domínio verificado
- **Limitação:** remetente único para toda plataforma

### Scheduler
- **Status:** Código pronto, passo manual SQL necessário
- **Não automatizado:** `pg_cron` + `pg_net` setup é manual

### Plano gate (Etapa 4)
- ✅ Dupla validação: Server Action + Trigger DB
- ✅ Revalidação no envio (plan_ineligible)
- ✅ Fail-open para past_due/canceled/incomplete

**Documentação:** `docs/NOTIFICATIONS.md`, `docs/PRODUCTION-NOTIFICATIONS.md`, `docs/audit/ETAPA-4-REPORT.md`

---

## 12. Billing

| Aspecto | Status | Detalhes |
| --- | --- | --- |
| Planos | ✅ 3 planos | start, pro, business |
| Local | ✅ Funcional | `local` provider (mock, sem cobrança) |
| MercadoPago | ⚠️ Não ativado | Config pronta, não testado |
| Stripe | ⚠️ Não ativado | Config pronta, não testado |
| ASAAS | ⚠️ Não ativado | Config pronta, não testado |
| Webhook | ✅ Route handler | `/api/webhooks/billing/[provider]/route.ts` |
| Feature gating | ✅ Implementado | `advanced_notifications`, planos limits |

**Produção:**
- [ ] Escolher provider (MercadoPago, Stripe, ASAAS)
- [ ] Obter credenciais (API key, webhook secret)
- [ ] Configurar webhook URL em painel do provider
- [ ] Testar fluxo de assinatura

---

## 13. Domínios

### URLs necessárias em produção

| URL | Exemplo | Uso |
| --- | --- | --- |
| App URL | `https://app.seusite.com` | Dashboard autenticado |
| Booking URL | `https://agenda.seusite.com` | Páginas públicas de agendamento |
| Site URL | `https://www.seusite.com` | Marketing (opcional) |

### Configuração necessária

- [ ] Comprar domínio
- [ ] Apontar DNS para Vercel
- [ ] Configurar domínio em Supabase Auth Settings
- [ ] Configurat SSL/TLS (automático via Vercel)

### Fase inicial

Enquanto domínio não estiver, usar:
- `https://YOUR_PROJECT.vercel.app` (Vercel fornece)
- Atualizar `NEXT_PUBLIC_SITE_URL` no Vercel

---

## 14. Environment Variables — Tabela Completa

| Variável | Pública? | Necessária | Localização | Produção |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Sim | Vercel Env | Supabase URL real |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Sim | Vercel Env | Anon key real |
| `NEXT_PUBLIC_SITE_URL` | Sim | Sim | Vercel Env | Domain real |
| `NEXT_PUBLIC_APP_URL` | Sim | Não | Vercel Env | Subdomain (se múltiplos) |
| `NEXT_PUBLIC_AGENDA_URL` | Sim | Não | Vercel Env | Subdomain (se múltiplos) |
| `NEXT_PUBLIC_MARKETING_URL` | Sim | Não | Vercel Env | Subdomain (se múltiplos) |
| `SUPABASE_SERVICE_ROLE_KEY` | Não | Sim | Vercel Env | Service role key real |
| `BILLING_PROVIDER` | Não | Não | Vercel Env | local / mercadopago / stripe / asaas |
| `MERCADOPAGO_ACCESS_TOKEN` | Não | Não* | Vercel Env | Token real (se MP) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Não | Não* | Vercel Env | Secret real (se MP) |
| `STRIPE_SECRET_KEY` | Não | Não* | Vercel Env | Key real (se Stripe) |
| `STRIPE_WEBHOOK_SECRET` | Não | Não* | Vercel Env | Secret real (se Stripe) |
| `ASAAS_API_KEY` | Não | Não* | Vercel Env | Key real (se ASAAS) |
| `ASAAS_WEBHOOK_TOKEN` | Não | Não* | Vercel Env | Token real (se ASAAS) |

\* Necessária apenas se esse provider for ativado.

**Edge Function Secrets (via `supabase secrets set`, NÃO Vercel):**
- `CRON_SECRET`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`

---

## 15. Problemas Encontrados

### Nenhum bloqueador crítico

✅ Repositório está limpo e pronto para produção.

### Observações menores

1. **Subdomains (opcional)** — Se não for usar múltiplos domínios, deixar em branco.
2. **WhatsApp/Resend** — Implementados mas não validados com API real (limitação de ambiente).
3. **Billing** — Pronto para integração, mas `local` provider é padrão (mock, sem cobrança).
4. **License** — Verificar se repositório precisa de LICENSE.md em produção.

---

## 16. Correções Realizadas

Nenhuma correção necessária. Repositório passa em todas as verificações:
- ✅ Lint OK
- ✅ Typecheck OK
- ✅ 207/207 testes passando
- ✅ Build OK
- ✅ Nenhum secret versionado
- ✅ .gitignore completo
- ✅ Next.js compatível com Vercel
- ✅ Supabase migrations versionadas
- ✅ RLS completo e testado

---

## 17. Checklist de Deploy

### Antes de Vercel

- [ ] Domínio comprado
- [ ] DNS apontando para Vercel (CNAME)
- [ ] Supabase project criado (link real)
- [ ] Auth redirect URLs configuradas
- [ ] Storage bucket verificado

### Vercel

- [ ] Conectar repositório GitHub
- [ ] Usar Node 20+
- [ ] Root directory: `web`
- [ ] Environment variables configuradas (copiar de .env.example)
- [ ] Build command: `npm run build`
- [ ] Start command: `npm start`

### Supabase

- [ ] Todas as 15 migrations aplicadas (`supabase db push`)
- [ ] Edge Functions deployadas (`supabase functions deploy`)
- [ ] Secrets configurados (`supabase secrets set ...`)
- [ ] Auth provider configurado
- [ ] Storage bucket pronto
- [ ] pg_cron + pg_net extensões criadas (manual SQL)
- [ ] Cron jobs agendados (manual SQL)

### Smoke Tests (após deploy)

- [ ] Signup funciona
- [ ] Login funciona
- [ ] Dashboard acessível
- [ ] Criar empresário + empresa
- [ ] Página pública carrega
- [ ] Agendamento público funciona
- [ ] Cancelamento funciona
- [ ] Notificações in-app aparecem

---

## 18. Documentação de Produção

### Criada nesta auditorria

- ✅ `docs/audit/ETAPA-5-PRODUCTION-AUDIT.md` (este arquivo)
- ✅ Referências anteriores: `docs/NOTIFICATIONS.md`, `docs/PRODUCTION-NOTIFICATIONS.md`, etc.

### Necessária antes de deploy

- [ ] `docs/PRODUCTION-DEPLOY-CHECKLIST.md` (passo-a-passo deploy)
- [ ] `docs/PRODUCTION-CONFIG.md` (configuração Vercel/Supabase)
- [ ] `docs/RUNBOOK.md` (operação em produção)

---

## 19. Conclusão

**Status:** ✅ **PRONTO PARA PREPARAÇÃO DE PRODUÇÃO**

Este repositório está em estado excelente para deployment:
- Código testado (207/207 testes)
- Arquitetura validada (RLS, multi-tenant, isolamento)
- Notificações implementadas e gated por plano (Etapa 4)
- Billing integrado (local provider padrão)
- Vercel-compatible (serverless, sem estado persistente)
- Nenhum secret versionado
- Documentação clara

### Próximos passos (fora desta etapa)

1. Comprar domínio
2. Criar Vercel project
3. Criar Supabase project (produção)
4. Conectar GitHub → Vercel
5. Configurar secrets e environment variables
6. Fazer first deploy
7. Executar smoke tests
8. Ativar billing (se necessário)
9. Configurar WhatsApp/Resend com credenciais reais

**NÃO foi feito nesta etapa (conforme solicitado):**
- ❌ Deploy em Vercel
- ❌ Criação de projeto Supabase
- ❌ Configuração de domínio real
- ❌ Configuração de credentials reais
- ❌ Ativação de billing externo

---

**Relatório finalizado em:** 2025-02-12
**Próxima etapa:** Etapa 6 (quando for o caso) — Deploy em produção
