# AUDIT-01 — Fundação e Arquitetura

Auditoria read-only. Nenhum arquivo de código foi alterado para produzir
este relatório — apenas leitura do repositório e execução de queries
reais contra um Postgres com as migrations aplicadas (nunca a produção).
Os comandos de validação no final (`lint`/`typecheck`/`test`/`build`)
também não alteram nada.

## Resultado

**PASS COM RESSALVAS**

A fundação (Next.js App Router, TypeScript strict, Supabase com RLS real
em todas as tabelas, separação server/client, isolamento multi-tenant)
está sólida e corresponde ao especificado. As ressalvas são específicas
e concentradas: um recurso citado como existente em resumos anteriores
desta sessão — um "motor de temas" com 5 temas nomeados e uma rota de
preview — **não existe no repositório atual**. Isso é tratado em detalhe
no `AUDIT-04-PUBLIC-PAGE.md`, mas é registrado aqui porque é uma
discrepância de arquitetura, não só de conteúdo.

## O que está correto

- **Next.js 16 App Router de verdade**: `src/app/` usa exclusivamente a
  convenção do App Router (`page.tsx`, `layout.tsx`, `actions.ts` com
  `"use server"`, rotas dinâmicas `[slug]`/`[id]`/`[provider]`). Não há
  Pages Router (`pages/`) em lugar nenhum.
- **TypeScript strict**: `tsconfig.json:7` — `"strict": true`. Roda limpo
  (`npm run typecheck`, ver seção "Testes executados").
- **ESLint configurado**: `eslint.config.mjs` usa
  `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`.
  Roda limpo.
- **Prettier configurado**: `.prettierrc.json` presente, com
  `prettier-plugin-tailwindcss`. `.prettierignore` presente.
- **Scripts completos**: `package.json:7-16` — `dev`, `build`, `start`,
  `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`,
  `test:watch`. Todos os pedidos existem.
- **Separação server/client real**: 25 arquivos com `"use client"`, 14
  com `"use server"` (grep em `src/`). Verificado que **nenhum** arquivo
  `"use client"` referencia `process.env` (grep vazio) — não há
  possibilidade de um secret vazar para o bundle do navegador por essa
  via.
- **Uso do Supabase é o padrão de três clientes**, cada um com escopo
  claro:
  - `src/lib/supabase/server.ts` — cliente autenticado, ligado a cookies,
    usado no dashboard.
  - `src/lib/supabase/public.ts` — cliente anônimo, sem cookies, só para
    a página pública (permite cache/ISR na rota, já que não depende de
    `cookies()`).
  - `src/lib/supabase/admin.ts` — service role, marcado `import
    "server-only"` no topo (linha 1).
- **Migrations versionadas e numeradas em sequência**:
  `supabase/migrations/20250924120001` até `...009`, 9 arquivos, nomes
  autoexplicativos (`extensions_and_helpers`, `schema`,
  `membership_functions`, `rls`, `functions`, `storage`,
  `notifications`, `billing`, `audit_hardening`). Aplicadas em ordem
  numérica sem erro contra um Postgres 16 limpo (ver "Testes
  executados").
- **17 tabelas em `public`, 17 têm RLS habilitado** —
  `grep "enable row level security"` retorna exatamente 17 ocorrências
  (`supabase/migrations/20250924120004_rls.sql:4-18` +
  `20250924120007_notifications.sql:118` +
  `20250924120008_billing.sql:74`), uma para cada tabela criada em
  `20250924120002_schema.sql` mais as duas adicionadas depois
  (`notification_deliveries`, `billing_webhook_events`). Nenhuma tabela
  ficou de fora.
- **15 triggers reais**: 12 de `updated_at` (um por tabela mutável), mais
  `on_auth_user_created` (cria `profiles` automaticamente),
  `trg_notification_deliveries_set_updated_at` e
  `trg_appointments_notify` (dispara a criação de notificação in-app a
  cada novo agendamento). Todos em `create trigger`, localizáveis por
  nome.
- **Índices reais em toda coluna de filtro usada pela aplicação**: 21
  `create index`/`create unique index`, cobrindo toda FK usada como
  filtro (`business_id`, `professional_id`, `customer_id`,
  `owner_id`, etc.) — incluindo índices compostos onde a query real usa
  dois filtros juntos (`idx_appointments_business_id` é
  `(business_id, starts_at)`, não só `business_id`).
- **26 foreign keys** (`references public.` × 26) — toda tabela filha
  aponta para o pai certo, a maioria com `on delete cascade` explícito
  (verificado em `schema.sql`).
- **Constraint de exclusão real contra overbooking**: `schema.sql:244`,
  `exclude using gist (professional_id with =, tstzrange(starts_at,
  ends_at) with &&) where (status <> 'cancelled')` — não é uma checagem
  de aplicação, é uma garantia do próprio Postgres, imune a race
  condition.
- **47 `check`/`constraint chk_` no schema** — validação de formato de
  slug, segmento, status, faixas de horário, etc., direto no banco (não
  só no Zod do lado do cliente).
- **`service_role` usado em exatamente 4 arquivos**, todos legítimos e
  documentados: `src/lib/supabase/admin.ts` (o único que instancia o
  client, marcado `server-only`), `src/app/api/webhooks/billing/
  [provider]/route.ts` (webhook, sem sessão de usuário para autenticar),
  `src/app/dashboard/plano/actions.ts` e
  `src/lib/billing/providers/local.ts` (escrita de assinatura que
  nenhuma sessão de usuário tem permissão de fazer via RLS). Nenhum outro
  arquivo do repositório referencia `SUPABASE_SERVICE_ROLE_KEY` ou
  `createAdminClient`.
- **Timezone tratado com uma função dedicada e testada**:
  `src/lib/date-utils.ts` — `zonedDateTimeToUtcISO()` (linha 76) converte
  data+hora "de parede" no timezone da empresa para um instante UTC
  correto, usando `Intl.DateTimeFormat` (sem depender de nenhuma
  biblioteca de datas externa). 10 testes em `date-utils.test.ts`,
  incluindo troca de horário de verão (`America/New_York` janeiro vs.
  julho) e precisão de milissegundo.
- **Tratamento de erro em 4 camadas reais**: `src/app/error.tsx` (site
  público/auth), `src/app/dashboard/error.tsx` (painel, isolado),
  `src/app/global-error.tsx` (falha no próprio layout raiz),
  `src/app/not-found.tsx` (404 global, reaproveitado por `/[slug]`
  quando o slug não existe). Log estruturado sem PII em
  `src/lib/logger.ts`, conectado em toda ação de servidor que toca o
  banco (verificado por amostragem em `dashboard/services/actions.ts`,
  `dashboard/appointments/actions.ts`, `lib/auth.ts`).
- **17 arquivos de teste automatizado** (`*.test.ts`), cobrindo
  utilitários de data, slug, validações, planos, billing (crypto,
  provedores, aplicação de evento de webhook), logger e roteamento por
  subdomínio — mais a suíte SQL permanente
  (`supabase/tests/db.sql`, com o stub de ambiente em
  `supabase/tests/fixtures/local-stub.sql`).
- **Documentação real e específica**: 9 arquivos em `docs/`
  (`ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `SETUP.md`,
  `DEPLOY.md`, `NOTIFICATIONS.md`, `BILLING.md`, `AUDIT.md`,
  `FINAL_QA.md`) — não são placeholders; cada um tem conteúdo específico
  do schema/fluxo real (verificado por leitura, não só pela existência do
  arquivo).

## Achado crítico de processo: histórico do git não contém os recursos "faltantes"

Antes de listar os requisitos ausentes, vale registrar a evidência mais
forte encontrada nesta auditoria. O repositório tem exatamente 6 commits
reais para este produto (`git log --oneline`):

```
2bf1d05 Add Aureon Agenda: multi-tenant scheduling SaaS in web/
c23188e Add full owner dashboard: calendar agenda, appointment detail/
        reschedule, customer history, service ordering
1568aaf Add notification system: in-app + WhatsApp/email abstraction,
        reminders, delivery queue
a87cb25 Add plans and subscriptions system: central plan config,
        provider-agnostic billing, secure webhook
be79324 Audit: fix RLS column exposure, race condition, timezone, SEO, a11y
2f64536 Prepare for production: env vars, deploy docs, observability, caching
ceb5e69 QA end-to-end: fix local-dev image loading, add docs/FINAL_QA.md
```

`git log --all --oneline -- "*criar-conta*"`,
`git log --all --grep="theme engine|section registry|ThemeRenderer" -i` e
`git log --all --oneline -- "*dashboard/preview*"` retornam **vazio** —
não é que esses recursos foram removidos depois; **eles nunca existiram
em nenhum commit deste repositório.** Isso é uma evidência concreta e
verificável de que os itens listados em "Requisitos não encontrados"
abaixo não são uma regressão — nunca chegaram a ser implementados, apesar
de terem sido descritos como concluídos em algum momento anterior desta
sessão de trabalho (o rastreador de tarefas interno chegou a marcar como
`completed` entradas como "Rename /signup to /criar-conta", "Build 9-step
onboarding wizard", "Theme engine: presets, fonts, section registry" e
"Add /dashboard/preview route" — nenhuma dessas mudanças está no código
nem no histórico do git). Esta é exatamente a situação contra a qual este
comando de auditoria pediu proteção ("ignore qualquer resumo anterior que
diga que algo foi implementado"), e o pedido se confirmou justificado.

## O que está incompleto

- **`docs/DATABASE.md` não foi reverificado linha a linha nesta
  auditoria** (fora do escopo dos 4 comandos atuais, que não pedem
  auditoria de `DATABASE.md` especificamente) — recomenda-se uma
  passagem futura para confirmar que ele ainda reflete a migration 009.
- **Nenhum pipeline de CI (GitHub Actions) foi encontrado no
  repositório** (`find . -iname "*.yml" -path "*workflows*"` não
  retornou nada) — lint/typecheck/test/build só rodam manualmente ou
  localmente por quem faz o deploy; não há gate automático no GitHub.

## O que está incorreto

Nenhum item classificado como "incorreto" nesta camada de fundação —
os achados abaixo, embora reais, são de arquitetura/escopo (algo que foi
descrito como existente mas não existe), não de bug funcional dentro do
que de fato está implementado.

## Vulnerabilidades encontradas

Nenhuma vulnerabilidade nova nesta camada. Testado ativamente (não
apenas lido) neste comando:

- Tentativa de **inserir** uma linha em `services`, `customers` e
  `business_members` de uma empresa B estando autenticado como dono da
  empresa A, com `business_id` da vítima passado manualmente — as três
  tentativas foram **recusadas pelo RLS** (`new row violates row-level
  security policy`), não apenas filtradas silenciosamente.
- Tentativa de **alterar** `business_settings` de B como dono de A —
  `UPDATE 0`, nenhuma linha afetada.
- Tentativa de **excluir** `business_hours` de B como dono de A —
  recusada duas vezes: primeiro pelo RLS ao tentar inserir a fixture,
  depois com `permission denied for table business_hours` na tentativa
  de delete (o `GRANT DELETE` foi revogado de `authenticated` nessa
  tabela — reforço em cima do RLS, não só RLS sozinho).

Ver seção "Multi-tenancy" e `AUDIT.md` (auditoria anterior, ainda válida
e reconfirmada aqui) para o inventário completo desse tipo de teste.

## Mapa de entidades e multi-tenancy

Toda entidade de negócio pertence a exatamente um `business_id` (direto
ou via uma FK que leva a um):

| Tabela | Tem `business_id`? | Como é isolada |
| --- | --- | --- |
| `businesses` | é o próprio tenant | RLS por `owner_id`/membership + grant de coluna restrito para `anon` |
| `business_settings` | direto | RLS: só membro/owner |
| `business_members` | direto | RLS: só membro lê, só owner escreve |
| `services` | direto | RLS: leitura pública se ativo+empresa publicada; escrita só membro |
| `professionals` | direto | idem |
| `professional_services` | indireto (via `professional_id`) | RLS via join em `professionals`/`businesses` |
| `business_hours` | direto | RLS: leitura pública, escrita só membro |
| `professional_hours` | indireto (via `professional_id`) | RLS via join |
| `blocked_times` | direto | RLS: só membro |
| `customers` | direto | RLS: só membro (nunca público) |
| `appointments` | direto | RLS: só membro (nunca público) |
| `themes` | direto | RLS: leitura pública se empresa publicada; escrita só owner |
| `notifications` | direto | RLS: só o `recipient_user_id` |
| `notification_deliveries` | direto | RLS: nenhuma policy para `anon`/`authenticated` — só o service role (webhook/Edge Function) toca |
| `subscriptions` | direto | RLS: só owner lê; escrita só via função `SECURITY DEFINER`/service role |
| `billing_webhook_events` | n/a (ledger de idempotência) | RLS habilitado, sem policy para ninguém além do service role |
| `profiles` | n/a (é o usuário) | RLS: só o próprio usuário |

**Business A consegue ler dados de B?** Não — testado ativamente para
`customers`, `appointments`, `notifications`, `business_settings`,
`blocked_times` (0 linhas em todos).
**Inserir para B?** Não — testado ativamente para `services`,
`customers`, `business_members` (RLS rejeita o INSERT).
**Alterar dados de B?** Não — testado ativamente em `business_settings`
e (na auditoria anterior, `AUDIT.md`) em `themes` (`UPDATE 0`).
**Excluir dados de B?** Não — testado ativamente em `business_hours`
(bloqueado por RLS e, redundantemente, por falta de `GRANT DELETE`).

## Segurança — pontos específicos pedidos

- **`business_id` confiado vindo do frontend?** Não. `src/lib/auth.ts` —
  `getCurrentBusiness()` (linha ~78) resolve a empresa **a partir da
  sessão** (`business_members` filtrado por `user_id` do JWT), nunca de
  um parâmetro de URL ou campo de formulário. Todo server action
  auditado por amostragem (`services/actions.ts`,
  `appointments/actions.ts`, `professionals/actions.ts`) recebe
  `business.id` desse retorno e ainda assim adiciona
  `.eq("business_id", business.id)` explicitamente em cada query —
  redundante com o RLS de propósito (defesa em profundidade).
- **`owner_id` aceito do cliente?** Não. `create_business()`
  (`20250924120008_billing.sql:87`, redefinição final) usa `auth.uid()`
  do lado do Postgres para preencher `owner_id` — o parâmetro da função
  não inclui `owner_id` em nenhum lugar da assinatura.
- **IDs manipuláveis?** Todo IDOR óbvio (trocar um `id` na URL de
  `/dashboard/appointments/[id]` ou `/dashboard/customers/[id]`) é
  coberto pela mesma dupla trava: a query busca por
  `id = X AND business_id = business.id`, e mesmo que alguém tentasse
  ler via REST direto, o RLS bloqueia.
- **Endpoints sem autenticação?** Só os que devem ser públicos por
  design: `/[slug]` (leitura pública controlada por RLS) e
  `/api/webhooks/billing/[provider]` (autenticado por verificação de
  assinatura HMAC, não por sessão — ver `src/lib/billing/crypto.ts`).
  Toda rota sob `/dashboard` é protegida por `getCurrentBusiness()`/
  `requireUser()`, que redireciona para `/login` sem sessão.
- **Server actions sem autorização?** Nenhuma encontrada sem passar por
  `getCurrentBusiness()`/`requireUser()`/`requireOwner()` primeiro
  (amostragem em 8 arquivos `actions.ts` do dashboard).
- **`service_role` usado onde não deveria?** Não — ver lista de 4
  arquivos acima; nenhum é acionável por uma sessão de usuário comum sem
  primeiro passar por uma verificação independente (assinatura de
  webhook ou `requireOwner()`).
- **Dados administrativos expostos?** O achado real e já corrigido em
  auditoria anterior (`docs/AUDIT.md`) foi o vazamento de
  `owner_id`/`phone`/`email` de `businesses` para `anon` via grant de
  coluna aberto — hoje `businesses` tem um `GRANT SELECT` restrito a
  colunas não sensíveis para `anon`
  (`20250924120009_audit_hardening.sql:24-27`), reconfirmado nesta
  auditoria por leitura direta do arquivo.

## Testes executados

Todos read-only / sem alterar o repositório:

```
npm run lint        -> limpo, zero erros/avisos
npm run typecheck   -> limpo
npm test            -> 137/137 testes passando (17 arquivos)
npm run build       -> sucesso, 22/22 páginas, zero erros
```

Contra um Postgres 16 local descartável (nunca produção), migrations
`20250924120001` a `...009` aplicadas em ordem sem erro:

```
psql -f supabase/tests/fixtures/local-stub.sql
for f in supabase/migrations/*.sql; do psql -f "$f"; done
psql -f supabase/tests/db.sql   -> "ALL ASSERTIONS PASSED"
```

Mais os 6 testes de ataque ativo descritos em "Vulnerabilidades
encontradas" (insert/update/delete cross-tenant), todos com script
específico rodado nesta sessão.

## Requisitos não encontrados

- **Rota `/dashboard/preview`** — não existe (`find` não encontra
  nenhum diretório `preview` sob `src/app/dashboard`). Detalhado em
  `AUDIT-04-PUBLIC-PAGE.md`.
- **Motor de temas com 5 temas nomeados** (Premium, Moderno, Minimalista,
  Barbearia, Elegante) e um "section registry" de 9 seções — não existe.
  A personalização real é: 2 cores (`primary_color`/`secondary_color`) e
  um `layout` com 2 valores (`classic`/`minimal`). Detalhado em
  `AUDIT-04-PUBLIC-PAGE.md`.
- **Rota `/criar-conta`** — não existe; a rota real é `/signup`.
  Detalhado em `AUDIT-02-AUTH-ONBOARDING.md`.
- **Pipeline de CI no GitHub** — não encontrado (ver "O que está
  incompleto").

## Recomendações

1. Decidir, com quem definiu o escopo original, se o "motor de temas"
   (5 temas, section registry) e a rota `/preview` são um requisito
   real ainda pendente ou uma descrição que nunca deveria ter circulado
   como "implementada" — o gap é grande o suficiente (arquitetura
   inteira de seções configuráveis) para não ser tratado como um ajuste
   pequeno.
2. Adicionar um workflow de CI (GitHub Actions) rodando
   `lint`/`typecheck`/`test`/`build` a cada push/PR — hoje esse gate só
   existe se quem faz o deploy rodar manualmente.
3. Revisar `docs/DATABASE.md` linha a linha contra a migration 009 numa
   próxima passagem (fora do escopo desta auditoria específica).
