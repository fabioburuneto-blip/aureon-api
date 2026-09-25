# AUDIT-10 — Produção: GitHub + Vercel + Supabase

Auditoria read-only. Nenhum código foi alterado. **Este ambiente não tem
acesso a nenhuma infraestrutura real** — não existe projeto Vercel
conectado, nem projeto Supabase de produção, nem credenciais de nenhum
provedor externo. Tudo abaixo que depender dessas infraestruturas está
marcado explicitamente como não testado contra o serviço real, conforme
exigido pelo comando. "O build passou" nunca é tratado aqui como prova
de que a infraestrutura está pronta.

## Resultado — o achado mais importante desta auditoria

**A branch `main` do repositório não contém nenhuma linha de código do
Aureon Agenda.** Todo o trabalho — as 9 migrations, o app inteiro em
`web/`, os 10 documentos de auditoria anteriores — existe **apenas** na
branch `claude/blissful-edison-4wt18p`. Se qualquer pipeline de deploy
(Vercel, CI) estiver configurado para acompanhar `main`, **nada disto
jamais foi publicado, e nada será publicado até que essa branch seja
integrada a `main` ou o alvo de deploy seja trocado.**

---

## GITHUB

### Branch principal vs. branch atual

```
main                          ← 50 commits, história TOTALMENTE separada
claude/blissful-edison-4wt18p ← 59 commits (branch atual), 9 à frente de main
```

`git merge-base main claude/blissful-edison-4wt18p` aponta para
`51f0e40` ("Update server.js", 2026-08-25) — **esse é o único ponto em
comum entre as duas branches.** A partir daí, `main` nunca recebeu
nenhum commit novo (seu HEAD ainda é esse mesmo commit), enquanto a
branch atual seguiu com 9 commits que criaram o Aureon Agenda do zero,
a partir de `2bf1d05` ("Add Aureon Agenda: multi-tenant scheduling SaaS
in web/", 2026-09-24).

`git ls-tree main --name-only` confirma: `main` contém só
`README.md`, `TraderAureonia_Slave.mq5`, `package.json`, `server.js` —
**nenhum diretório `web/`, nenhuma migration, nenhum documento de
auditoria.** Todo o produto está isolado na branch de trabalho.

### Commits

- Branch atual: 59 commits no total, sendo os 9 mais recentes
  (`2bf1d05` até `0c5bdc2`) responsáveis por todo o Aureon Agenda —
  scaffold inicial, dashboard, notificações, billing, os 4 primeiros
  documentos de auditoria (`AUDIT-01` a `AUDIT-04`), e os 4 seguintes
  (`AUDIT-05` a `AUDIT-08`).
- Mensagens de commit são descritivas e específicas (não genéricas tipo
  "update"), cobrindo o que foi adicionado em cada etapa.

### Working tree / arquivos não commitados

`git status --short` no início desta auditoria mostrava só o arquivo
novo `web/docs/audit/AUDIT-09-SECURITY.md` (criado pela auditoria
anterior, ainda não commitado no momento desta verificação) — nenhuma
alteração de código pendente, nenhum arquivo esquecido.

### `.gitignore`

- **`web/.gitignore`** existe e cobre `node_modules`, `.next`, `.env*`,
  `*.pem`, logs de build — adequado para o projeto Next.js.
- **A raiz do repositório NÃO TEM `.gitignore` próprio.** O projeto
  "TraderAureonia" na raiz (server.js/package.json/arquivo `.mq5`) não
  tem nenhuma proteção contra commitar acidentalmente um `node_modules/`
  ou `.env` próprio caso alguém rode `npm install`/crie configuração ali
  — risco baixo hoje (nada desse tipo está commitado, confirmado abaixo),
  mas é uma lacuna real de higiene do repositório como um todo.

### Secrets acidentalmente commitados

- `git ls-files | grep -iE "\.env|node_modules"` → só
  `web/.env.example` (sem valores reais, só placeholders).
- Busca em **todo o histórico** (`git log --all -p`) por padrões comuns
  de segredo (chaves AWS `AKIA...`, chaves Stripe `sk_live_...`, blocos
  `BEGIN...PRIVATE KEY`) → **nenhuma ocorrência**, em nenhuma branch.
- Reconfirma `AUDIT-09`: nenhum valor real de `SUPABASE_SERVICE_ROLE_KEY`
  ou de tokens de provedor jamais apareceu em um commit.

### Migrations

9 arquivos em `supabase/migrations/`, todos com timestamp sequencial
(`20250924120001` a `20250924120009`), sem gaps nem duplicatas — a
mesma sequência foi aplicada, do zero, em todas as auditorias anteriores
contra bancos descartáveis, sempre com sucesso.

### Documentação

`web/docs/` contém: `README.md`, `ARCHITECTURE.md`, `AUDIT.md`,
`BILLING.md`, `DATABASE.md`, `DEPLOY.md`, `FINAL_QA.md`,
`NOTIFICATIONS.md`, `SECURITY.md`, `SETUP.md`, mais o diretório
`docs/audit/` com os 9 relatórios de auditoria read-only (incluindo
este). Cobertura de documentação é ampla e específica (não genérica),
incluindo um guia de deploy passo a passo (`DEPLOY.md`) que já assume
corretamente a separação GitHub → Vercel → Supabase.

### Qual branch contém cada funcionalidade importante

Como só existe uma branch de trabalho (não há branches de feature
adicionais nem outras branches de Claude/Codex além desta), a resposta é
direta: **toda funcionalidade do Aureon Agenda — fundação, auth,
onboarding, serviços, disponibilidade, página pública, agendamento,
dashboard, notificações, billing, e todas as auditorias — existe
exclusivamente em `claude/blissful-edison-4wt18p`. Nenhuma parte do
produto existe em `main`.**

---

## VERCEL

**Nenhum projeto Vercel real está conectado a este ambiente — tudo
abaixo é verificação de configuração no repositório, nunca um deploy
real.**

| Item | Situação |
| --- | --- |
| Build | `next build` (Turbopack) roda limpo localmente, sem erros, gerando 22 páginas estáticas/dinâmicas — mas isso **nunca foi executado dentro do ambiente de build da Vercel** |
| Node | `package.json` declara `"engines": { "node": ">=20.9.0" }` — a Vercel respeita isso ao escolher a runtime; nunca testado contra um build real da Vercel |
| `next.config.ts` | Mínimo e específico: só `images.remotePatterns` (restrito à origem do Storage do Supabase, ver `AUDIT-09`) e uma flag de dev (`dangerouslyAllowLocalIP`, só em `NODE_ENV=development`). Sem `output: "standalone"` nem outra customização de runtime |
| Image domains | Calculados dinamicamente a partir de `NEXT_PUBLIC_SUPABASE_URL` — **corretos por construção**, mas dependem de essa env var estar definida corretamente no projeto Vercel real; se estiver ausente/errada em produção, `remotePatterns` fica vazio e toda imagem de logo/capa quebra silenciosamente (nenhum teste real disso foi feito, pois não há projeto Vercel) |
| Environment variables | Ver seção ENVIRONMENT abaixo — nenhuma foi configurada em nenhum projeto Vercel real |
| Runtime | Next.js padrão (Node.js runtime para as rotas server-rendered, nenhuma rota declarada como Edge Runtime) — não testado contra a Vercel |
| Routes | 22 rotas geradas no build local (ver lista abaixo), a maioria dinâmica (`ƒ`), poucas estáticas (`○`) — nunca servidas por um deploy real |
| Cache | Nenhuma configuração de cache customizada (`revalidate`, `fetchCache`) encontrada além do padrão do App Router — não testado sob tráfego real |
| Redirects | Nenhum `redirects()`/`headers()` em `next.config.ts` — os únicos redirecionamentos do app são os de subdomínio, feitos em runtime pelo `proxy.ts` (ver seção Arquitetura de Subdomínio abaixo), não pela configuração estática da Vercel |
| Domínio | Nenhum domínio real configurado ou testado — `NEXT_PUBLIC_SITE_URL` no `.env.example` aponta para `http://localhost:3000` por padrão |

**Rotas geradas pelo build local** (para referência, nenhuma testada em
produção):

```
○ /  ○ /_not-found  ƒ /[slug]  ƒ /api/webhooks/billing/[provider]
ƒ /auth/confirm  ƒ /dashboard (+ 13 subrotas)  ○ /login  ƒ /onboarding
○ /robots.txt  ○ /signup  ƒ /sitemap.xml
```

---

## SUPABASE

**Nenhum projeto Supabase real (hospedado) está conectado a este
ambiente.** Todo teste de banco desta e das auditorias anteriores usou
um Postgres 16 local descartável com as migrations reais aplicadas —
válido para provar que o **SQL está correto**, mas não prova nada sobre
o Supabase hospedado em si (Auth real com e-mail de verdade, Storage
real com upload de verdade, Edge Functions realmente implantadas, cron
realmente agendado).

| Área | Situação |
| --- | --- |
| Migrations | 9 arquivos, aplicados com sucesso repetidas vezes contra Postgres local — **nunca aplicados contra um projeto Supabase hospedado real** (`supabase db push` nunca foi executado neste ambiente, sem credenciais/rede para isso) |
| Auth | Fluxo de signup/confirmação de e-mail (`/auth/confirm`, `verifyOtp`) testado com um Postgres local que **stuba** `auth.users`/`auth.uid()` — nunca testado contra o serviço real de Auth do Supabase (que envia e-mail de verdade, tem seu próprio rate-limit, templates de e-mail configuráveis no dashboard, etc.) |
| Storage | Bucket `business-assets`, políticas e limites de MIME/tamanho testados via RLS direta no Postgres local — **nunca testado contra a API real de Storage** (upload de arquivo de verdade, CDN de entrega, geração de URL pública real) |
| RLS | Extensivamente testada contra Postgres local (todas as 17 tabelas, ataques multi-tenant reais) — o comportamento do **Postgres em si** está bem coberto; o que não está coberto é qualquer particularidade do ambiente gerenciado do Supabase (poolers de conexão, `pgbouncer`, limites de plano) |
| Functions (Edge Functions) | `appointment-reminders` e `process-notifications` são código Deno real e correto (ver `AUDIT-07`) — **nunca implantadas** (`supabase functions deploy` nunca executado), nunca invocadas contra o runtime real do Supabase Edge Functions |
| Secrets | Documentados corretamente em `.env.example`/`docs/NOTIFICATIONS.md`/`docs/BILLING.md` sobre como configurar via `supabase secrets set` — **nunca configurados de fato**, porque não há projeto real |
| Cron / pg_net | **Não existe em nenhuma migration** (confirmado em `AUDIT-07`) — é um passo manual documentado (`docs/NOTIFICATIONS.md`, seção "Agendar a execução"), nunca executado neste ambiente nem em nenhum projeto real conhecido |
| Triggers | `trg_appointments_notify`, `trg_*_set_updated_at` e os triggers de negócio (slug, updated_at) — todos testados e funcionando corretamente no Postgres local; comportamento no Postgres gerenciado do Supabase deve ser idêntico (é o mesmo motor Postgres 16), mas isso não foi confirmado contra o serviço hospedado |

---

## Diferenciação obrigatória: o que foi testado, e contra o quê

| Camada | Status |
| --- | --- |
| **LOCALMENTE TESTADO** | Todo o SQL (schema, RLS, triggers, funções, constraints), toda a lógica de negócio (booking engine, dedup de cliente, concorrência via 2 processos reais, dashboard, notificações — arquitetura e idempotência —, billing — webhook/idempotência/permissões), lint/typecheck/testes unitários (137 testes)/`next build` local. Tudo isso é real e reproduzível, mas roda contra um Postgres efêmero neste ambiente, não contra Supabase. |
| **SUPABASE REAL TESTADO** | **Nada.** Nenhuma chamada foi feita contra um projeto Supabase hospedado nesta ou em nenhuma auditoria anterior verificável no repositório. |
| **VERCEL REAL TESTADO** | **Nada.** Nenhum deploy foi feito. `next build` local não é equivalente a um build bem-sucedido no ambiente de CI da Vercel (que usa suas próprias variáveis de ambiente, região, cache de build). |
| **INTEGRAÇÃO EXTERNA REAL TESTADA** | **Nada.** WhatsApp Cloud API, Resend, Stripe, Mercado Pago, Asaas — todos têm código de integração real e correto (ver `AUDIT-07`/`AUDIT-08`), mas nenhuma chamada de rede real foi feita contra nenhum desses provedores; os únicos testes existentes usam `fetch` mockado. |

**"O build passou" não é tratado como prova de infraestrutura pronta em
nenhum ponto deste documento** — é prova de que o código TypeScript
compila e o SQL é sintaticamente/semanticamente válido contra um
Postgres 16 genérico, nada mais.

---

## ENVIRONMENT — variáveis necessárias

| Variável | Classificação | Obrigatória? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | Sim |
| `NEXT_PUBLIC_SITE_URL` | PUBLIC | Sim |
| `NEXT_PUBLIC_APP_URL` | PUBLIC / DOMÍNIO | Não (só para arquitetura de subdomínios) |
| `NEXT_PUBLIC_AGENDA_URL` | PUBLIC / DOMÍNIO | Não (idem) |
| `NEXT_PUBLIC_MARKETING_URL` | PUBLIC / DOMÍNIO | Não (idem) |
| `SUPABASE_SERVICE_ROLE_KEY` | SERVER | Sim (webhook de billing e modo local dependem dela) |
| `BILLING_PROVIDER` | SERVER | Não (ausente = modo `local`, sem cobrança real) |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` | SERVER | Só se `BILLING_PROVIDER=mercadopago` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_IDS` | SERVER | Só se `BILLING_PROVIDER=stripe` |
| `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` | SERVER | Só se `BILLING_PROVIDER=asaas` |
| `CRON_SECRET` | EDGE FUNCTION SECRET | Sim, se lembretes/fila de notificação forem usados |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | EDGE FUNCTION SECRET | Não (ausente = WhatsApp fica "sem provedor configurado") |
| `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` | EDGE FUNCTION SECRET | Não (mesmo comportamento de fallback) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (dentro das Edge Functions) | EDGE FUNCTION SECRET | Injetadas automaticamente pelo Supabase, não precisam ser configuradas manualmente |

Todas listadas e documentadas corretamente em `.env.example` com
comentários explicando cada uma — não há nenhuma variável usada no
código que não esteja documentada ali (`grep -rn "process.env\." src/`
comparado manualmente contra o arquivo confirma cobertura completa).

---

## Arquitetura de subdomínio (app / agenda / www / slug)

Lido `src/proxy.ts` (equivalente ao `middleware.ts` nesta versão do
Next.js — ver nota em `AGENTS.md` sobre convenções renomeadas) +
`src/lib/subdomain-routing.ts`:

- A separação em 3 subdomínios (`app.`, `agenda.`, `www.`) é
  **condicional**: só ativa se as três env vars
  (`NEXT_PUBLIC_APP_URL`/`AGENDA_URL`/`MARKETING_URL`) estiverem
  definidas com hosts distintos. Por padrão (nenhuma configurada), tudo
  roda em um único domínio — comportamento atual/testado.
- Quando ativa, o `proxy()` redireciona requisições para o host correto
  com base no path (ex.: uma rota de `/dashboard` acessada por
  `agenda.seusite.com` seria redirecionada para `app.seusite.com`).
- **Classificação: PREPARADA, não REALMENTE FUNCIONANDO em produção.**
  A lógica de redirecionamento foi testada apenas por leitura de código
  e (presumivelmente, conforme trabalho anterior) por testes unitários
  de `subdomain-routing.ts` — nunca contra três domínios/subdomínios
  DNS reais apontando para um deploy real da Vercel. Não há evidência
  de que essa arquitetura tenha sido validada com hosts de verdade.
- O roteamento por **slug** (`/[slug]`) é a única parte dessa
  arquitetura que foi de fato exercitada de ponta a ponta neste
  ambiente (via `next build` + os testes de RLS/booking), mas mesmo
  esse teste rodou contra `localhost`, nunca um domínio de produção
  real.

---

## O que falta para colocar no ar com clientes reais

1. **Decidir o destino do merge** — `main` precisa receber este
   trabalho (merge da branch, ou trocar o branch de deploy da Vercel
   para `claude/blissful-edison-4wt18p`) antes de qualquer deploy fazer
   sentido.
2. Criar um projeto Supabase de produção dedicado (nunca reaproveitar
   um projeto de desenvolvimento) e rodar `supabase db push` de verdade.
3. Configurar Auth (Site URL, Redirect URLs) no projeto Supabase real.
4. Criar o projeto na Vercel, conectar ao repositório/branch corretos,
   configurar todas as env vars de `ENVIRONMENT` acima na Vercel
   (produção e, se for o caso, preview).
5. Implantar as duas Edge Functions (`supabase functions deploy`).
6. Configurar `pg_cron`/`pg_net` manualmente no projeto Supabase real
   para agendar `appointment-reminders`/`process-notifications`
   (nenhuma migration faz isso — ver `AUDIT-07`).
7. Configurar `CRON_SECRET` e demais secrets de Edge Function via
   `supabase secrets set`.
8. Decidir e configurar um provedor de billing real (`BILLING_PROVIDER`)
   antes de aceitar qualquer pagamento — hoje roda em modo `local`
   (sem cobrança real) por padrão, ver `AUDIT-08`.
9. Testar de ponta a ponta pelo menos um envio real de WhatsApp e um de
   e-mail com credenciais reais antes de depender deles em produção.
10. Corrigir o achado CRÍTICO de `AUDIT-09` (vazamento de
    `owner_id`/`phone`/`email` de `businesses` para qualquer usuário
    autenticado) antes de aceitar o primeiro cliente real — é uma
    correção de uma migration pequena, mas é um bloqueador de
    segurança, não de infraestrutura.
11. Configurar domínio(s) reais e (se desejado) a separação de
    subdomínios `app`/`agenda`/`www` — hoje só existe em modo single-domain
    testado.
12. Adicionar um `.gitignore` na raiz do repositório (item de higiene,
    não bloqueador).

Nenhum destes 12 itens envolve reescrever lógica de produto — são todos
passos de configuração/infraestrutura/deploy, exceto o item 10, que é
uma correção de segurança pontual já detalhada em `AUDIT-09`.
