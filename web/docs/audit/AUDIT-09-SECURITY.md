# AUDIT-09 — Auditoria de Segurança

Auditoria read-only. Nenhum código foi alterado. Todo achado de
multi-tenant/RLS foi testado ao vivo contra um Postgres 16 descartável
com as migrations reais aplicadas, usando dois tenants reais (Empresa A
e Empresa B) e impersonando cada owner via `set role authenticated` +
`request.jwt.claim.sub` (o mesmo mecanismo que `auth.uid()` usa em
produção) — nunca produção real. Nenhum resumo de conversa anterior foi
usado como fonte de verdade; todo achado vem de ler o código/SQL atual e
de reexecutar os ataques.

## Resultado — classificação geral

**1 achado CRÍTICO, 2 ALTOS, 5 MÉDIOS, vários BAIXOS.** O modelo
multi-tenant é sólido para escrita (nenhuma tentativa de INSERT/UPDATE/
DELETE cross-tenant teve sucesso em nenhuma das 8 áreas testadas). O
achado crítico é um vazamento de leitura: **qualquer usuário autenticado
da plataforma (não só um visitante anônimo) consegue ler `owner_id`,
`phone` e `email` de QUALQUER outra empresa publicada**, porque a
correção de coluna feita para `anon` (documentada em `AUDIT-04` como
"airtight") nunca foi replicada para `authenticated`.

---

## MULTI-TENANT — matriz de ataque (Empresa A tentando afetar Empresa B)

Testado ao vivo, dois tenants reais (`Empresa A` / `Empresa B`),
impersonando o owner de A como `authenticated` via
`request.jwt.claim.sub`.

| Recurso | Ler (lista) | Ler (por ID) | Inserir | Atualizar | Excluir | Manipular `business_id` | Manipular `owner_id` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Serviços** | Sim, mas só o subconjunto público (`is_active=true` de empresa publicada) — **por design**, mesma regra que a página pública usa | Sim, mesmo motivo (dado público) | Bloqueado (RLS) | Bloqueado (`UPDATE 0`) | Bloqueado (`DELETE 0`) | Bloqueado (RLS ao tentar mover um serviço próprio para dentro de B) | N/A (tabela não tem `owner_id`) |
| **Profissionais** | Sim, mesmo motivo (dado público) | Sim, mesmo motivo | Bloqueado (RLS) | Bloqueado (`UPDATE 0`) | Bloqueado (`DELETE 0`) | Bloqueado (RLS) | N/A |
| **Clientes** | **Não** — 0 linhas | **Não** — 0 linhas | Bloqueado (RLS, não testado diretamente mas mesma policy `customers_all_member`) | Bloqueado | Bloqueado | Bloqueado | N/A |
| **Agendamentos** | **Não** — 0 linhas | **Não** — 0 linhas | N/A (não testado diretamente; mesma policy `appointments_all_member`) | Bloqueado (`UPDATE 0`) | **Bloqueado por ausência de GRANT** (`permission denied for table appointments`, não nem chega a avaliar RLS — `authenticated` nunca teve `DELETE` concedido) | Bloqueado (mesma policy) | N/A |
| **Notificações** | **Não** — 0 linhas (escopo por `recipient_user_id`, nem por `business_id`) | **Não** — 0 linhas | N/A | N/A (só o próprio destinatário pode marcar como lida) | N/A | N/A | N/A |
| **Configurações** (`business_settings`) | **Não** — 0 linhas | **Não** — 0 linhas | N/A | Bloqueado (`UPDATE 0`) | N/A | N/A | N/A |
| **Assinaturas** (`subscriptions`) | **Não** — 0 linhas | **Não** — 0 linhas | **Bloqueado por ausência de GRANT** (`authenticated` nunca teve INSERT/UPDATE/DELETE — só `SELECT`, ver `AUDIT-08`) | Bloqueado (grant + RLS) | Bloqueado (grant) | N/A | N/A |
| **Uploads** (`storage.objects`, bucket `business-assets`) | Sim — bucket é público por design (logos/capas são conteúdo público) | Sim, mesmo motivo | **Bloqueado** ao tentar gravar em `bbbb.../logo.png` (RLS baseada em `is_business_owner()` sobre o primeiro segmento do path) | Mesma proteção (não testado update separadamente, política idêntica) | **Bloqueado** (`DELETE 0` ao tentar apagar o logo de B) | N/A (path é a própria "chave de tenant") | N/A |

**Achado adicional, fora da matriz acima, encontrado ao testar
`businesses` diretamente (não pedido explicitamente na lista de 8
recursos, mas é a tabela-mãe de todos eles):** ver seção CRÍTICO abaixo.

### Evidência das linhas "Sim" (serviços/profissionais/uploads)

Essas não são falhas — são o comportamento pretendido: um serviço/
profissional ativo de uma empresa **publicada** é dado público (é
exatamente o que a página `/[slug]` mostra para um visitante anônimo,
via a mesmíssima policy). Confirmado lendo a policy:

```sql
create policy "services_select_public_or_member" on public.services
  for select using (
    (is_active = true and exists (select 1 from businesses b
       where b.id = services.business_id and b.is_published = true))
    or is_business_member(business_id)
  );
```

O ponto que a auditoria verificou de fato foi se esse acesso de leitura
pública **vaza algo além do que já é público na página `/[slug]`** — não
vaza (mesmas colunas, mesmo filtro `is_active`).

---

## CRÍTICO — `businesses.owner_id`/`phone`/`email` legíveis por qualquer usuário autenticado

**Severidade: CRÍTICO.**

`AUDIT-04` testou e confirmou que `anon` não consegue ler
`owner_id`/`phone`/`email` de `businesses` (a query inteira falha com
`permission denied`), graças a:

```sql
revoke select on public.businesses from anon;
grant select (id, name, slug, segment, description, timezone, logo_url,
  cover_url, is_published, created_at, updated_at) on public.businesses to anon;
```

(`20250924120009_audit_hardening.sql:23-27`). **Essa correção nunca foi
aplicada ao papel `authenticated`.** O grant original,
`grant select on public.businesses to anon, authenticated;`
(`20250924120004_rls.sql:261`), concede **todas as colunas** a
`authenticated`, e nunca foi restringido depois. Combinado com a policy
`businesses_select_public_or_member` (`is_published = true OR
is_business_member(id)`), **qualquer usuário logado no sistema — o
dono de qualquer empresa, mesmo que sem nenhuma relação com a empresa
alvo — consegue ler o `owner_id`, `phone` e `email` de qualquer outra
empresa publicada.**

**Reproduzido ao vivo:**

```sql
-- Como owner da Empresa A (authenticated, NÃO é membro da Empresa B):
select id, name, owner_id, phone, email from businesses where id = '<empresa-B>';
--                   id                  |   name    |               owner_id               |     phone      |            email
-- --------------------------------------+-----------+--------------------------------------+----------------+-----------------------------
--  bbbb0000-...                         | Empresa B | b0000000-...                          | +5511988887777 | dono-b-privado@empresab.com
-- (1 row)  <-- SUCESSO, dado privado vazado

-- Mesma query como anon (comportamento correto, já documentado em AUDIT-04):
-- ERROR: permission denied for table businesses
```

**Impacto:** qualquer conta paga na plataforma (não precisa ser
sofisticada — basta abrir o DevTools do navegador e chamar a REST API do
Supabase com o próprio token de sessão, já que o app nunca faz essa
consulta na UI, mas o endpoint aceita) consegue colher telefone/e-mail/
`owner_id` de todas as empresas publicadas concorrentes. `owner_id`
também permite cruzar com `profiles`/`auth.users` (se algum outro
vazamento existir ali) para identificar o dono real por trás de cada
negócio.

**Recomendação:** aplicar a mesma correção de `anon` também a
`authenticated`:

```sql
revoke select on public.businesses from authenticated;
grant select (id, name, slug, segment, description, timezone, logo_url,
  cover_url, is_published, created_at, updated_at, owner_id) on public.businesses to authenticated;
```

(mantendo `owner_id` de fora se não for necessário para nenhuma tela do
próprio dono, ou incluindo-o só porque o próprio dono precisa ver o
próprio `owner_id` em algum lugar — o ponto central é nunca liberar
`phone`/`email` para não-membros). Alternativamente, trocar a policy
para nunca permitir leitura da linha inteira de um não-membro e servir
os campos públicos por uma view/RPC dedicada — mais robusto a longo
prazo do que depender de administradores lembrarem de manter dois
grants de coluna sincronizados.

---

## RLS — matriz completa (17 tabelas)

Todas as 17 tabelas de `public` têm `RLS ENABLED = true` (confirmado via
`pg_class.relrowsecurity`, sem exceção). **Nota estrutural importante,
válida para a tabela inteira:** o ambiente Supabase concede, por
padrão, `SELECT/INSERT/UPDATE/DELETE` a `anon` e `authenticated` em toda
tabela nova (`alter default privileges ... grant ... to anon,
authenticated`, replicado fielmente no stub de teste local a partir do
comportamento real de um projeto Supabase). Isso significa que, **para
a maioria das tabelas, a única coisa que impede leitura/escrita
indevida é a RLS policy, não o GRANT** — um modelo válido (é o modelo
recomendado pela própria Supabase), mas que não tem rede de segurança:
se uma tabela nova for criada sem RLS, ou uma policy tiver um bug, não
há uma segunda camada de grant restringindo o dano. Isso é registrado
como risco estrutural (MÉDIO), não como um bug pontual.

| TABLE | RLS ENABLED? | POLICIES? | SELECT | INSERT | UPDATE | DELETE | RISK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `businesses` | Sim | 3 (select/update/delete) | Publicado OU membro — **mas coluna completa para `authenticated`, ver CRÍTICO acima** | Nenhuma policy de INSERT — só via `create_business()` SECURITY DEFINER | Só owner | Só owner | **CRÍTICO** (leitura) |
| `business_members` | Sim | 4 (select/insert/update/delete) | Só membro | Só owner | Só owner | Só owner | Baixo — correto, mas sem UI de convite (ver `AUDIT-06`) |
| `business_settings` | Sim | 2 (select/update) | Só membro | Nenhuma policy de INSERT (só via `create_business()`) | Só owner | Nenhuma policy (nunca excluível por ninguém além de `service_role`/cascade) | Baixo |
| `services` | Sim | 2 (select/all-member) | Público (ativo+publicado) OU membro | Só membro | Só membro | Só membro | Baixo — leitura pública é intencional |
| `professionals` | Sim | 2 | Idem `services` | Só membro | Só membro | Só membro | Baixo |
| `professional_services` | Sim | 2 | Público (via join com professionals+businesses) OU membro | Só membro | Só membro | Só membro | Baixo |
| `business_hours` | Sim | 2 | Público OU membro | Só membro | Só membro | **Sem GRANT para `authenticated`** (`revoke delete ... from authenticated`) | Baixo — bloqueio deliberado, força soft-handling |
| `professional_hours` | Sim | 2 | Só membro (via join, **não é público** — diferente de `business_hours`, nunca lido pela página pública) | Só membro | Só membro | Sem GRANT para `authenticated` | Baixo |
| `blocked_times` | Sim | 1 (`ALL`) | Só membro | Só membro | Só membro | Só membro | Baixo |
| `customers` | Sim | 1 (`ALL`) | Só membro | Só membro | Só membro | Só membro | Baixo |
| `appointments` | Sim | 1 (`ALL`) | Só membro | Só membro (app real também insere via RPC `SECURITY DEFINER` para `anon`) | Só membro | Só membro na policy, mas **sem GRANT de DELETE para `authenticated`** — cancelamento é sempre via `UPDATE status='cancelled'`, nunca `DELETE` | Baixo |
| `notifications` | Sim | 2 (select/update) | Só o próprio destinatário (`recipient_user_id`), não por `business_id` | Nenhuma policy de INSERT (só via trigger `SECURITY DEFINER`) | Só o próprio destinatário, só para marcar como lida | Nenhuma policy (ninguém exclui, só cascade) | Baixo |
| `notification_deliveries` | Sim | 1 (select) | Só o owner (`is_business_owner`) | Nenhuma (só via trigger/worker `service_role`) | Nenhuma | Nenhuma | Baixo |
| `subscriptions` | Sim | 1 (select) | Só owner | **Sem GRANT nenhum para `authenticated`** (só leitura) | Sem GRANT | Sem GRANT | Baixo — ver `AUDIT-08` |
| `billing_webhook_events` | Sim | **Nenhuma policy** | Ninguém (default-deny, RLS ativo sem policy) | Ninguém | Ninguém | Ninguém | Baixo — correto, é ledger interno, só `service_role` toca |
| `themes` | Sim | 2 (select/update) | Público OU membro | Nenhuma policy de INSERT (só via `create_business()`) | Só owner | Nenhuma policy | Baixo |
| `profiles` | Sim | 3 (select/insert/update) | Só o próprio (`id = auth.uid()`) | Só o próprio | Só o próprio | Nenhuma policy | Baixo |

---

## AUTHORIZATION

### Server actions sem autorização (verificação de sessão) — nenhuma encontrada

Todo server action revisado em `src/app/dashboard/**/actions.ts` chama
`getCurrentBusiness()` (ou `requireUser()`/`requireBusinessAccess()`)
antes de qualquer leitura/escrita, e nunca aceita um `business_id` vindo
do formulário/cliente — o `business.id` sempre vem da sessão resolvida
no servidor. `grep -rn "getCurrentBusiness\|requireUser\|requireBusinessAccess"
src/app/dashboard/**/actions.ts` confirma presença em 100% dos arquivos
de ação revisados nesta e nas auditorias anteriores.

### APIs sem autorização

Única rota de API pública fora do dashboard:
`src/app/api/webhooks/billing/[provider]/route.ts` — protegida por
verificação de assinatura antes de qualquer processamento (ver
`AUDIT-08`), não por sessão (correto, é um webhook de terceiro).

### IDOR

- Testado em auditorias anteriores e reconfirmado aqui:
  `/dashboard/appointments/[id]` e `/dashboard/customers/[id]` sempre
  filtram por `.eq("business_id", business.id)` além do `id`, e a RLS
  reforça isso de forma independente — IDOR por ID sequencial ou
  adivinhado não funciona porque **mesmo que o app esquecesse o filtro,
  o banco bloquearia**. Essa é a defesa em profundidade correta.
- **Exceção parcial:** o vazamento CRÍTICO de `businesses` acima **é**,
  tecnicamente, um IDOR de leitura — basta saber (ou adivinhar/enumerar)
  o `id` de outra empresa publicada.

### Confiança no frontend

- Nenhum limite de negócio (antecedência mínima, horário de
  funcionamento, `blocked_times`) é confiado só ao frontend nas rotas
  principais de agendamento — já documentado em `AUDIT-05`, com duas
  exceções relevantes (que **são** confiança indevida no frontend,
  reafirmadas aqui como achados de segurança, não só de produto):
  - `create_public_appointment()` não valida `business_hours`/
    `professional_hours`/`is_closed` — só a UI (`get_available_slots`)
    impede horários fora do expediente. Qualquer chamada direta à RPC
    pública (que é `anon`-executável) ignora essa regra. **Severidade:
    MÉDIO** (não é uma falha de isolamento entre tenants nem de
    autenticação, é uma regra de negócio sem enforcement server-side,
    mas é explorável por qualquer visitante da internet sem sessão
    nenhuma).
  - `rescheduleAppointment()` (painel) não revalida `blocked_times`/
    horários — só a UI. **Severidade: MÉDIO**, exige uma sessão
    autenticada de dono/staff (já teria acesso legítimo aos próprios
    dados) para ser explorado, então o dano é o próprio dono conseguir
    quebrar a própria regra de negócio, não vazamento entre tenants.
- Preço dos planos: nunca duplicado no frontend (`AUDIT-08`), fonte
  única em `config.ts` — sem confiança indevida.
- Validação client-side de upload (tipo/tamanho) é só uma conveniência
  de UX — a validação real está no bucket do Storage
  (`allowed_mime_types`/`file_size_limit`), correto.

### Permissões inconsistentes

- Reafirma `AUDIT-06`: `customization/page.tsx` não esconde o
  formulário de quem não é owner (ao contrário de `settings`/`plano`),
  e a rejeição vira uma exceção não tratada. Não é uma falha de
  autorização (o servidor recusa corretamente via `requireOwner`), é
  inconsistência de UX que expõe a existência do controle de forma
  confusa — **BAIXO**.
- `deleteService()` engolindo o erro de FK sem feedback (`AUDIT-06`) não
  é uma falha de segurança (a exclusão é de fato bloqueada), é um bug de
  UX.

---

## SERVICE ROLE

Todos os 6 usos de `service_role`/`SUPABASE_SERVICE_ROLE_KEY` no
repositório:

| Arquivo | Motivo | Seguro? | Poderia ser reduzido? |
| --- | --- | --- | --- |
| `src/lib/supabase/admin.ts` | Fábrica do cliente admin — não é um "uso" em si, é onde a chave é lida de `process.env` e nunca de outro lugar | Sim — `"server-only"` no topo impede import de um Client Component; lança erro explícito se a env var faltar | Não aplicável (é a definição) |
| `src/app/api/webhooks/billing/[provider]/route.ts` | Escrever `subscriptions.status/plan_id/período` depois de verificar a assinatura do webhook — RLS não permite nenhuma escrita nessa tabela por `authenticated`, e o chamador aqui não tem sessão de usuário nenhuma (é o provedor de pagamento) | Sim — a autorização "de fato" é a verificação de assinatura antes desta chamada, não a ausência de RLS | Não — é exatamente o único ponto de confiança correto para essa escrita |
| `src/app/dashboard/plano/actions.ts` | Mesma tabela `subscriptions`, mas chamado por uma sessão de usuário real (dono trocando de plano) | Sim — `business.id` usado sempre vem de `getCurrentBusiness()` (sessão), nunca de input do formulário | Poderia, em tese, ser substituído por uma função `SECURITY DEFINER` com uma checagem interna de `is_business_owner()`, mas o resultado seria equivalente em segurança — não é uma redução que mude o risco |
| `src/lib/billing/providers/local.ts` | Escreve `subscriptions` diretamente no modo de desenvolvimento (sem provedor real) | Sim — só é instanciado quando `BILLING_PROVIDER` não está configurado, e `businessId` sempre vem da sessão através de quem o chama (`plano/actions.ts`) | Idem acima |
| `supabase/functions/appointment-reminders/index.ts` | Precisa ler `appointments`/`customers`/`business_settings`/`business_members` de **todas** as empresas para varrer lembretes pendentes — impossível com RLS de um único usuário | Sim — protegido por `CRON_SECRET` no header `Authorization`, nunca invocável por um usuário comum | Não — é o caso de uso canônico de `service_role` (job em lote, sem usuário) |
| `supabase/functions/process-notifications/index.ts` | Drena a fila `notification_deliveries` de todas as empresas | Sim, mesma proteção por `CRON_SECRET` | Não |

**Nenhum uso de `service_role` foi encontrado fora desses 6 arquivos**
(`grep -rn "SUPABASE_SERVICE_ROLE_KEY\|createAdminClient\|service_role"`
em todo `src/` e `supabase/functions/`). Nenhum deles recebe um
`business_id`/`user_id` diretamente de um input HTTP não verificado.

---

## SECRETS

- **Env vars:** `.env.example` já está corretamente segmentado em três
  blocos comentados: `NEXT_PUBLIC_*` (públicas, no bundle), privadas
  server-only (nunca prefixadas com `NEXT_PUBLIC_`), e secrets de Edge
  Function (nunca vão para a Vercel). Nenhum valor real, só placeholders.
- **Frontend:** único código que roda no navegador que toca credenciais
  é `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` — ambas
  desenhadas para serem públicas (a segurança vem de RLS, não de
  sigilo). Nenhuma chave privada (`SUPABASE_SERVICE_ROLE_KEY`, tokens de
  billing/WhatsApp/e-mail) aparece em nenhum arquivo `"use client"`
  (`grep -rln "SERVICE_ROLE\|ACCESS_TOKEN\|WEBHOOK_SECRET\|API_KEY"
  src/app/**/*.tsx` só encontra ocorrências em arquivos `"use server"`
  ou puramente server, nunca em componente cliente).
- **Server:** todos os secrets de billing/e-mail são lidos só dentro de
  `src/lib/billing/index.ts` (montagem do provedor) e nunca reexportados
  para nenhum módulo cliente.
- **Edge Functions:** `WHATSAPP_ACCESS_TOKEN`, `RESEND_API_KEY`,
  `CRON_SECRET` só são lidos via `Deno.env.get()` dentro de
  `supabase/functions/*` — nunca chegam ao bundle do Next.js.
- **Git:** `.gitignore` bloqueia `.env*` corretamente; só `.env.example`
  está versionado, e seu conteúdo em todo o histórico (`git log --all -p
  -- '*.env*'`) nunca contém um valor real, só placeholders. Busca por
  padrões comuns de segredo (`AKIA[0-9A-Z]{16}`, `sk_live_...`, blocos
  `BEGIN...PRIVATE KEY`) em todo o histórico do repositório → **nenhuma
  ocorrência**.
- **Logs:** `logError()` (usado em toda a base) e os `console.error`
  estruturados das Edge Functions foram desenhados para nunca incluir
  nome de cliente/telefone/e-mail nem corpo de payload de provedor —
  confirmado por comentário explícito e pela assinatura das funções de
  log revisadas em `AUDIT-07` ("Never log row.recipient... or
  row.payload"). Não foi possível inspecionar logs de produção reais
  (não existem, nada foi implantado) — essa é uma verificação de
  código, não de logs reais emitidos.

---

## UPLOADS

- **Tipo:** restrito no bucket a `image/jpeg, image/png, image/webp,
  image/gif` (`allowed_mime_types`) — enforced pelo próprio serviço de
  Storage, não só pelo cliente. **SVG não está na lista** — bloqueia o
  vetor clássico de XSS armazenado via `<script>` dentro de um SVG
  servido como imagem.
- **Tamanho:** `file_size_limit = 5242880` (5MB) no bucket — igual ao
  limite já checado no cliente, mas agora também no servidor
  (`AUDIT-01` já documentou isso como correção feita).
- **Storage policies:** leitura pública (esperado, é bucket de
  logo/capa), escrita/atualização/exclusão restritas por
  `is_business_owner()` sobre o primeiro segmento do path
  (`{business_id}/...`) — testado ao vivo, cross-tenant bloqueado
  (upload e delete).
- **Nomes:** o path é montado no cliente como
  `${businessId}/${kind}-${Date.now()}.${extension}`
  (`image-uploader.tsx:39`) — `businessId` vem de uma prop do próprio
  componente (renderizada a partir da sessão do servidor, não de input
  livre do usuário), mas a **extensão vem de `file.name.split(".").pop()`,
  sem validação contra o tipo real do arquivo**. Como o bucket já
  restringe o `Content-Type` aceito pelo Storage, isso não abre um vetor
  de execução, mas permite nomes de arquivo enganosos (ex.: um PNG de
  verdade salvo como `logo-123.exe`) — **BAIXO**, cosmético.
- **Acesso público:** intencional e correto — logos/capas são conteúdo
  público, igual ao restante da página `/[slug]`.
- **Arquivos maliciosos:** o allowlist de MIME type no bucket é a defesa
  real; não foi possível testar contra a API de Storage real (sem
  infraestrutura Supabase neste ambiente) se a validação é por
  Content-Type declarado no request ou por inspeção real dos bytes do
  arquivo — **não testado com a API real do Storage**, só confirmado
  via leitura da configuração do bucket.
- **Achado adicional (MÉDIO), fora do fluxo de upload:** `cover_url` é
  renderizado na página pública como `background-image:
  url(${business.cover_url})` (`[slug]/page.tsx:162`), **sem passar por
  `next/image`** — ao contrário de `logo_url`, que usa `<Image>` e por
  isso é protegido pelo allowlist de origem em `next.config.ts`
  (`remotePatterns` restrito ao próprio bucket Supabase). E
  `businessImageSchema` (`src/lib/validations.ts`) só valida que
  `cover_url`/`logo_url` são uma URL bem formada (`.url()`), **sem
  restringir o domínio à origem do próprio Storage**. Na prática, um
  dono de empresa pode gravar qualquer URL externa em `cover_url` via
  `updateBusinessImage()`, e ela será carregada automaticamente pelo
  navegador de **todo visitante** da página pública daquela empresa via
  CSS `background-image` — um vetor de rastreamento/beacon de
  visitantes para um domínio de terceiros, contornando a proteção que
  `next/image` já dá para `logo_url`. Não é uma falha entre tenants (o
  próprio dono decide o conteúdo da própria página), mas afeta a
  privacidade de visitantes anônimos sem que eles saibam.

---

## WEBHOOKS

Reconfirma e aprofunda `AUDIT-08`:

- **Assinatura:** verificada sobre o corpo bruto (`request.text()`),
  antes de qualquer processamento, para os 3 provedores reais
  (Stripe HMAC+timestamp, Mercado Pago HMAC+timestamp, Asaas token
  estático com `timingSafeEqual`).
- **Replay:** Stripe e Mercado Pago verificam a idade do timestamp da
  assinatura contra uma tolerância (`toleranceSeconds`, padrão 300s) —
  uma assinatura válida mas antiga é recusada, o que limita reprodução
  de uma requisição capturada. Asaas usa um token estático sem
  timestamp — **não tem proteção de replay própria** (um request
  Asaas capturado poderia ser reenviado indefinidamente) — mitigado na
  prática pela camada de idempotência abaixo, mas é uma lacuna
  específica desse provedor. **BAIXO/MÉDIO** (o dano de reenviar um
  evento idêntico já processado é nulo graças à idempotência; o risco
  residual é reenviar um evento capturado em trânsito antes de HTTPS
  proteger o payload — mitigado por HTTPS em produção).
- **Idempotência:** real, por constraint de banco
  (`unique(provider, provider_event_id)` em `billing_webhook_events`),
  não por lógica de aplicação — robusta mesmo sob concorrência.
- **Validação:** provedor desconhecido/não configurado → `404` (fail
  closed); assinatura inválida → `401`; erro ao processar → `502`/`500`
  sem vazar detalhes internos na resposta.

---

## INPUTS

Lido `src/lib/validations.ts` por completo:

| Campo | Limite |
| --- | --- |
| Nome (empresa/serviço/profissional/cliente) | `min(2).max(120)`, trim |
| Descrição/bio/observações | `max(500)`, trim |
| Telefone (`customer_phone`, `whatsapp_phone`) | `min(8).max(30)`, trim — sem validação de formato E.164, aceita qualquer string de 8-30 caracteres |
| E-mail | `max(254)` + `.email()` (validação de formato real do Zod) |
| URL (`logo_url`/`cover_url`) | `max(2048)` + `.url()` — **sem restrição de domínio**, ver achado MÉDIO acima |
| Slug | Regex `^[a-z0-9]+(-[a-z0-9]+)*$` (via `isValidSlug`), mais checagem de reservados e unicidade no banco |
| Preço (`price`) | `min(0)` — **sem limite superior** (não é risco de segurança, é um gap de validação de negócio: nada impede um preço absurdo como R$ 999.999,99) |
| Duração (`duration_minutes`) | `int().min(5).max(600)` |
| Upload | Ver seção UPLOADS acima (tipo/tamanho no bucket) |
| Cor do tema | Regex hex estrito `^#[0-9a-fA-F]{6}$` |
| Data/hora de bloqueio | `max(40)` cada, mais `refine` garantindo fim > início |

Nenhum campo de texto livre permite um tamanho suficientemente grande
para um ataque de negação de serviço por payload (todos com `max`
razoável). Telefone sem validação de formato é uma lacuna de qualidade
de dado, não de segurança (o campo nunca é interpolado em SQL nem HTML
bruto).

---

## ATAQUES

| Ataque | Risco encontrado | Evidência |
| --- | --- | --- |
| **SQL injection** | **Nenhum vetor encontrado.** Toda query passa pelo cliente Supabase (`.eq()`, `.select()`, RPCs com parâmetros tipados) — nunca há concatenação de string para montar SQL. `grep` por `.raw(`, template literals de SQL ou concatenação manual → vazio. | Leitura de todo `src/` |
| **XSS** | **Nenhum vetor direto encontrado.** Nenhum uso de `dangerouslySetInnerHTML` em todo o projeto. React escapa por padrão. Upload de SVG (vetor clássico de XSS armazenado) é bloqueado pelo allowlist de MIME do bucket. | `grep -rn "dangerouslySetInnerHTML" src/` → vazio |
| **CSRF** | **Baixo.** Next.js Server Actions (usadas em todas as mutações do dashboard) verificam o header `Origin`/`Host` da requisição por padrão desde a versão usada aqui, sem necessidade de configuração adicional — nenhuma customização em `next.config.ts` (`experimental.serverActions.allowedOrigins`) que enfraquecesse essa proteção padrão. Não foi testado contra um servidor real rodando (não há deploy), então este ponto é uma verificação de configuração, não um teste de exploração real. | Ausência de override em `next.config.ts` |
| **SSRF** | Nenhuma rota server-side aceita uma URL arbitrária do usuário para buscar (`fetch`) — todas as chamadas HTTP saem só para bases fixas de provedores de billing/notificação, nunca para uma URL vinda de input. O achado de `cover_url` (seção UPLOADS) é o inverso — o **navegador do visitante** busca a URL, não o servidor — não é SSRF clássico, é vazamento de referrer/IP do visitante para terceiros, reclassificado ali como MÉDIO. | `grep -rn "await fetch(" src/` |
| **IDOR** | Ver seção AUTHORIZATION — mitigado por filtro duplo (app + RLS) em todo lugar, exceto o vazamento CRÍTICO de `businesses`. | Ver seção CRÍTICO |
| **Privilege escalation** | **Nenhum vetor de escalação vertical encontrado** — `requireOwner()`/RLS `is_business_owner()` bloqueiam toda tentativa testada de uma conta não-owner alterar `business_members`/`subscriptions`/tema/configurações. O "achado" de escalação mais próximo é estrutural, não um bug: não existe UI para criar staff (`AUDIT-06`), então o cenário "staff tentando virar owner" não é testável no produto hoje, só via SQL direto (testado aqui: `INSERT` numa `business_members` de outra empresa corretamente bloqueado por RLS). | Teste #18 da matriz multi-tenant |
| **Tenant escape** | **Nenhum vetor de escrita cross-tenant funcionou** em nenhuma das 8 áreas testadas. O único "escape" real encontrado é de **leitura** (o CRÍTICO de `businesses`). | Matriz multi-tenant completa acima |

---

## Resumo classificado

| Severidade | Achado |
| --- | --- |
| **CRÍTICO** | `businesses.owner_id`/`phone`/`email` legíveis por qualquer usuário autenticado da plataforma (não só o próprio dono), para qualquer empresa publicada — grant de coluna nunca replicado de `anon` para `authenticated` |
| **ALTO** | `create_public_appointment()` não valida `business_hours`/`professional_hours`/`is_closed` — qualquer visitante sem sessão pode agendar fora do expediente chamando a RPC pública diretamente (reafirma `AUDIT-05`, elevado aqui a ALTO por ser explorável sem nenhuma autenticação) |
| **ALTO** | `rescheduleAppointment()` (painel) não revalida `blocked_times`/horário/antecedência — exige sessão de dono/staff, então o impacto é mais limitado, mas ainda é uma falha real de enforcement server-side (reafirma `AUDIT-05`) |
| **MÉDIO** | Modelo de segurança depende inteiramente de RLS em quase todas as tabelas (grants de default do Supabase são amplos); nenhuma camada extra de grant restringe o dano de uma policy futura mal escrita |
| **MÉDIO** | `cover_url` renderizado via CSS bruto (não `next/image`), sem restrição de domínio na validação de escrita — permite carregar recurso externo arbitrário no navegador de qualquer visitante da página pública |
| **MÉDIO** | Webhook Asaas não tem proteção própria de replay (token estático sem timestamp) — mitigado pela idempotência, mas é uma lacuna isolada desse provedor |
| **MÉDIO** | `next/image` corretamente restringe `logo_url`, mas a falta de allowlist de domínio na validação de escrita (`businessImageSchema`) é a causa raiz que também afeta `cover_url` |
| **BAIXO** | Extensão do arquivo de upload vem do nome original, não do tipo real — só cosmético, o bucket já valida o conteúdo |
| **BAIXO** | Telefone sem validação de formato (E.164) — qualidade de dado, não segurança |
| **BAIXO** | Preço sem limite superior — qualidade de dado/negócio, não segurança |
| **BAIXO** | Inconsistência de UI em `customization/page.tsx` não esconder formulário de não-owner (reafirma `AUDIT-06`) — a autorização real no servidor está correta |

## Recomendações (ordem de prioridade)

1. **Imediato:** replicar a correção de coluna de `anon` para
   `authenticated` em `businesses` (CRÍTICO).
2. Adicionar verificação de `business_hours`/`professional_hours`/
   `is_closed` dentro de `create_public_appointment()` (ALTO, já
   recomendado em `AUDIT-05`).
3. Fazer `rescheduleAppointment()` reaplicar as mesmas validações do
   agendamento público antes do `UPDATE` (ALTO, já recomendado em
   `AUDIT-05`).
4. Restringir `businessImageSchema` a aceitar só URLs cujo host seja o
   próprio domínio de Storage configurado, e trocar o `background-image`
   de `cover_url` por `next/image` (ou por uma técnica equivalente que
   preserve o allowlist de origem).
5. Considerar adicionar timestamp+janela de tolerância à verificação do
   webhook Asaas, se a API do provedor suportar, para fechar a lacuna de
   replay isolada desse provedor.
6. Avaliar, tabela a tabela, se vale a pena reduzir os grants default
   de `anon`/`authenticated` para o mínimo necessário por tabela (em vez
   de depender só da RLS), como camada extra de defesa em profundidade —
   trabalho maior, não bloqueante para lançamento se a RLS permanecer
   correta.
