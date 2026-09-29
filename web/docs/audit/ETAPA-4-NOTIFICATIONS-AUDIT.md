# ETAPA 4 — Auditoria completa de notificações

**Read-only. Nenhum código foi alterado.** Todo achado de RLS/isolamento
foi reproduzido ao vivo contra um Postgres 16 descartável com as 14
migrations reais aplicadas (nunca produção); todo achado sobre
providers/retry/templates foi confirmado lendo o código-fonte atual e
rodando a suíte de testes existente (nenhuma chamada de rede real a
WhatsApp/Resend foi feita, nem seria possível neste ambiente). Nenhum
resumo de conversa anterior ou auditoria anterior (`AUDIT-07-NOTIFICATIONS.md`,
`AUDIT-08-BILLING.md`) foi tratado como verdade — cada afirmação abaixo foi
reconferida contra o código/schema como ele existe agora, depois da P0 e
das Etapas 1-3.

## 0. Estado do repositório antes de começar

```
branch: claude/blissful-edison-4wt18p
git status: limpo (nada pendente)
HEAD: 61a0e23 — fix: remove non-deterministic timestamp from Etapa 3 SQL test fixture
```

Confirmado antes de ler qualquer arquivo. Nenhuma alteração foi feita
durante esta auditoria.

---

## RESULTADO GERAL

**A arquitetura é real, correta e genuinamente conectada de ponta a
ponta** — não é estrutura visual vazia em nenhum lugar verificado. O
núcleo (trigger→fila→worker) nunca foi tocado desde `AUDIT-07`, e o novo
fluxo de auto-atendimento do cliente (Etapa 3: cancelar/reagendar por
token) **já dispara notificação automaticamente, sem nenhum código
novo**, porque o trigger é por tabela, não por função — confirmado ao
vivo. Dois achados genuinamente novos nesta rodada (não documentados nas
auditorias anteriores):

1. **O gate de plano (`advanced_notifications`) só existe na Server
   Action — nunca no banco.** Um dono autenticado pode ligar
   WhatsApp/e-mail no próprio `business_settings` chamando a API REST do
   Supabase diretamente (mesma sessão, mesma chave anon), contornando
   `canUseFeature()` por completo. Severidade MÉDIA — ver seção 11.
2. **Nada revalida o gate depois que ele foi ligado.** Se uma assinatura
   cai para `past_due`/`canceled` (que **falham aberto** por decisão de
   produto documentada em `evaluate.ts`), os canais continuam ativos e o
   worker continua enviando — o gate só existe no instante de marcar a
   caixinha, nunca de novo depois.

Tudo o que já estava classificado como **"implementado mas não testado
com API real"** continua exatamente nesse estado — nenhum teste contra
WhatsApp Cloud API/Resend reais foi ou pôde ser feito aqui. O scheduler
(`pg_cron`) continua **fora de qualquer migration**, um passo manual.

---

## 1. MAPA COMPLETO DE ARQUIVOS ENCONTRADOS

Busca exaustiva por nome de arquivo + grep por todos os termos pedidos
(`notification`, `notify`, `reminder`, `whatsapp`, `email`, `resend`,
`delivery`, `queue`, `retry`, `template`, `pg_cron`, `webhook`, etc.) em
todo o repositório, não assumindo nada pelo nome:

```
supabase/migrations/20250924120007_notifications.sql   # schema + trigger + RLS
supabase/functions/process-notifications/index.ts       # worker: drena a fila
supabase/functions/appointment-reminders/index.ts        # worker: varre e enfileira lembretes
supabase/functions/_shared/notifications/
  types.ts / templates.ts / retry.ts / dispatch.ts / http.ts
  providers/{whatsapp,email,in-app}.ts (+ .test.ts de cada um acima)
src/app/dashboard/notification-bell.tsx
src/app/dashboard/notifications/{page.tsx,actions.ts}
src/app/dashboard/settings/notification-settings-form.tsx
src/app/dashboard/settings/actions.ts                    # updateNotificationSettings + gate de plano
src/lib/plans/{config,evaluate,limits}.ts                # advanced_notifications
docs/NOTIFICATIONS.md
docs/audit/AUDIT-07-NOTIFICATIONS.md, AUDIT-08-BILLING.md (leitura anterior, não fonte de verdade)
```

Nenhum outro arquivo relacionado (grep de `pg_notify`, `webhook` fora do
billing, `queued`) apareceu além destes. `grep -rn "cron.schedule\|pg_cron\|pg_net"` em
`supabase/` só encontra **comentários** nos dois Edge Functions — zero
ocorrência em qualquer `.sql` de migration.

---

## 2. BANCO DE DADOS — catálogo de objetos

### Tabela: `notifications`

| Campo | Valor |
| --- | --- |
| **TIPO** | Tabela, já existia antes (base), estendida em `20250924120007` |
| **FINALIDADE** | Notificação in-app, uma linha por (evento, dono destinatário) |
| **QUEM PODE ACESSAR** | `authenticated`, apenas o próprio `recipient_user_id` |
| **RLS** | `notifications_select_recipient` (select), `notifications_update_recipient` (update) — ambas `recipient_user_id = auth.uid()`. Sem policy de INSERT (só o trigger `SECURITY DEFINER` escreve) nem DELETE. |
| **COMO É CRIADO** | Só dentro de `notify_appointment_event()` (trigger) ou de `appointment-reminders` (via `service_role`, bypassa RLS) |
| **COMO É PROCESSADO** | Lida pelo dashboard (`notification-bell.tsx`, `/dashboard/notifications`) |
| **COMO É FINALIZADO** | `read_at` setado via `markNotificationRead`/`markAllNotificationsRead` — nunca apagada |
| **POSSÍVEIS FALHAS** | Nenhuma encontrada na escrita (é local, mesma transação). Índice `(recipient_user_id, read_at, created_at desc)` cobre as duas queries reais do dashboard. |
| **Isolamento entre empresas — testado ao vivo** | Owner B: `select count(*) from notifications where business_id = <A>` → **0**. `update ... where business_id = <A>` (tentando marcar como lida) → **UPDATE 0**. `anon`: mesma query → **0** (RLS filtra por `auth.uid()`, que é `null` para `anon`; não é "permission denied", é filtro silencioso — grant de tabela é o padrão amplo do Supabase, já documentado como risco estrutural em `AUDIT-09`, reconfirmado aqui, não é um achado novo). |

### Tabela: `notification_deliveries`

| Campo | Valor |
| --- | --- |
| **TIPO** | Tabela nova (criada em `20250924120007`) |
| **FINALIDADE** | Fila de envio assíncrono (uma linha por tentativa de canal externo) |
| **QUEM PODE ACESSAR** | `authenticated` só com **SELECT**, só o **owner** do negócio (`is_business_owner`) |
| **RLS** | Uma única policy, `notification_deliveries_select_owner` (select). **Nenhuma policy de insert/update/delete** — e nenhum grant de escrita para `authenticated` (`grant select ... to authenticated`, sem `insert/update/delete`). Só o trigger (`SECURITY DEFINER`) e o worker (via `service_role`, que ignora RLS) escrevem. |
| **COMO É CRIADO** | Dentro do mesmo trigger, condicionado a `whatsapp_enabled`/`notify_email_enabled` + o toggle do evento específico |
| **COMO É PROCESSADO** | `process-notifications` (Edge Function, `service_role`) — único leitor que também escreve |
| **COMO É FINALIZADO** | `status` vira `sent` (sucesso), `retrying` (com `next_attempt_at`) ou `failed` (terminal) |
| **POSSÍVEIS FALHAS** | Nenhuma no desenho — ver seção 12 para as falhas de rede tratadas |
| **Isolamento — testado ao vivo** | Owner B → **0** linhas de A. Owner A tentando **INSERT** uma linha forjada → **bloqueado por RLS** (`new row violates row-level security policy`) — confirma que nem o próprio dono consegue fabricar uma entrega arbitrária (destinatário/canal livres) por fora do trigger. Owner A tentando **UPDATE** `status = 'sent'` numa linha própria (fingir que um envio aconteceu) → **UPDATE 0**, nenhuma linha afetada — não existe caminho de escrita para `authenticated` nesta tabela, ponto. |
| **Índices** | `(status, next_attempt_at) where status in ('pending','retrying')` (parcial, para o worker escanear só o que importa) + `(business_id, created_at desc)` |
| **Constraint** | `channel in ('email','whatsapp')`, `event_type in (8 valores)`, `status in ('pending','sent','failed','retrying')` — todos via `check`, não enum Postgres (mesmo padrão de `plan_id`, documentado como decisão consciente em outras migrations) |
| **Deduplicação/idempotência** | Não há `unique` nesta tabela — a idempotência real está a montante, em `appointments.reminder_24h_sent_at`/`reminder_2h_sent_at` (ver seção 8). Para eventos de escrita (criado/cancelado/reagendado), cada `INSERT`/`UPDATE` em `appointments` só pode dar origem a **um** disparo do trigger, então não há como duplicar uma entrega pelo mesmo evento sem uma segunda escrita real na tabela `appointments`. |

### Colunas em `appointments` (não uma tabela nova, mas parte do domínio)

`reminder_24h_sent_at`, `reminder_2h_sent_at` — timestamps, `null` até o
lembrete correspondente ser enfileirado. É a **chave de idempotência**
dos lembretes (ver seção 8).

### Colunas em `business_settings` (config de notificação)

`whatsapp_enabled`, `whatsapp_phone`, `notify_email_enabled`,
`notify_email_address`, `notify_new_appointment`, `notify_cancellation`,
`notify_reschedule`, `notify_reminder_24h`, `notify_reminder_2h`. Todas
`boolean not null default` sensato ou `text` nullable. **Nenhuma
credencial aqui** — só destino (telefone/e-mail) e toggles, confirmado
lendo a migration e `docs/NOTIFICATIONS.md`.

### Function/Trigger: `notify_appointment_event()` / `trg_appointments_notify`

| Campo | Valor |
| --- | --- |
| **TIPO** | Function `plpgsql`, `SECURITY DEFINER`; trigger `AFTER INSERT OR UPDATE` em `appointments`, `FOR EACH ROW` |
| **FINALIDADE** | Única origem de todo evento relacionado a agendamento (exceto lembretes, que vêm de uma varredura separada) |
| **QUEM PODE ACESSAR** | Ninguém chama diretamente — dispara sozinho em qualquer INSERT/UPDATE de `appointments`, não importa quem/o quê fez a escrita (RPC pública `anon`, server action `authenticated`, ou a nova RPC de token da Etapa 3) |
| **RLS** | Não aplicável a uma trigger function `SECURITY DEFINER` — ela insere como o dono da função, não como o chamador |
| **COMO É CRIADO** | Não muda desde `20250924120007` — confirmado por `git diff` vazio entre essa migration e `HEAD` para este objeto |
| **COMO É PROCESSADO** | Decide o evento (`INSERT`→created; `UPDATE` com `status` mudando→confirmed/cancelled/completed/no_show; `UPDATE` com `starts_at`/`ends_at` mudando sem mudar `status`→rescheduled), monta título/mensagem, insere 1 notificação in-app por owner + até 2 linhas de fila (email/whatsapp) por owner, conforme os toggles |
| **COMO É FINALIZADO** | `return new;` — nunca bloqueia nem reverte a escrita original, mesmo em teoria (não há chamada de rede aqui, só inserts locais) |
| **POSSÍVEIS FALHAS** | **Achado (latente, não um bug ativo hoje):** a lógica é `if status mudou → evento X; elsif starts_at/ends_at mudou → rescheduled`. Se um único `UPDATE` mudasse `status` **e** `starts_at` ao mesmo tempo, só o evento de status dispararia — o reagendamento ficaria silenciosamente sem notificação própria. **Nenhum caminho de código hoje faz isso** (`updateAppointmentStatus`/`cancel_public_appointment` só tocam `status`; `rescheduleAppointment`/`reschedule_appointment`/`reschedule_public_appointment` só tocam `starts_at`/`ends_at`) — documentado como risco para uma feature futura que combine as duas coisas num só `UPDATE`, não como um problema atual. |

**Confirmado ao vivo, novo nesta auditoria:** chamei
`cancel_public_appointment()` (RPC pública da Etapa 3, não existia
quando `AUDIT-07` foi escrita) contra um agendamento com
`whatsapp_enabled`/`notify_email_enabled` ligados — resultado: 1
notificação in-app nova + 2 linhas novas na fila (`email`/`whatsapp`,
`event_type = 'appointment.cancelled'`, `status = 'pending'`), sem
nenhum código escrito para isso na Etapa 3. A tabela é `AFTER UPDATE`
por linha, não por função chamadora — qualquer forma de atualizar
`appointments.status`/`starts_at`/`ends_at` já herda o mesmo
comportamento automaticamente.

### Grants (resumo)

| Tabela | `anon` | `authenticated` |
| --- | --- | --- |
| `notifications` | grant default (mas RLS filtra tudo, `auth.uid()` nulo) | select + update, RLS restringe a `recipient_user_id = auth.uid()` |
| `notification_deliveries` | grant default (RLS sem policy → nada visível) | **só select**, RLS restringe a `is_business_owner()`; **nenhuma policy/grant de escrita** |

---

## 3. EVENTOS QUE DISPARAM NOTIFICAÇÃO

| Evento | 1. Quem dispara | 2. Camada | 3-6. Banco/Action/Edge/Trigger | 7. Duplicação possível? | 8. Idempotente? | 9. Retry? | 10. Falha no processamento |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `appointment.created` | `create_public_appointment()` (RPC pública, `anon`) | Banco | Trigger (`AFTER INSERT`) | Não — 1 `INSERT` = no máximo 1 disparo | Sim, por construção (1 insert = 1 evento) | N/A (in-app é síncrono; fila entra `pending`, worker cuida do resto) | Ver seção 6/7 (providers) |
| `appointment.confirmed` | `updateAppointmentStatus` (painel) | Server Action → banco | Trigger (`AFTER UPDATE`, `status`) | Não | Sim | N/A — **não vai para WhatsApp/e-mail, só in-app** (decisão de escopo, no comentário do SQL) | — |
| `appointment.cancelled` | `updateAppointmentStatus` (painel) **ou** `cancel_public_appointment()` (cliente, Etapa 3) | Server Action / RPC pública → banco | Trigger | Não | Sim | Sim (fila) | Ver seção 6/7 |
| `appointment.rescheduled` | `rescheduleAppointment`/`reschedule_appointment()` (painel) **ou** `reschedule_public_appointment()` (cliente, Etapa 3) | Server Action / RPC pública → banco | Trigger (`starts_at`/`ends_at` mudam) | Não (ver risco latente acima sobre `status`+`starts_at` juntos, que hoje nunca acontece) | Sim | Sim (fila) | Ver seção 6/7 |
| `appointment.completed` | `updateAppointmentStatus` (painel) | Server Action → banco | Trigger | Não | Sim | N/A — só in-app | — |
| `appointment.no_show` | `updateAppointmentStatus` (painel) | Server Action → banco | Trigger | Não | Sim | N/A — só in-app | — |
| `appointment.reminder_24h` / `reminder_2h` | `appointment-reminders` (Edge Function, varredura) | Edge Function (`service_role`) → banco | Não é trigger — é uma query agendada externamente | Sim, teoricamente (2 execuções sobrepostas) — mitigado, ver seção 8 | Sim, por 2 mecanismos independentes (coluna nula + stamp antes de decidir) | Sim (fila) | Erro por item é capturado e logado, não derruba a varredura inteira |

**Nenhum evento novo foi criado nesta auditoria** — a tabela acima é
inteiramente descritiva do que já existe.

---

## 4. NOTIFICAÇÕES INTERNAS (in-app)

Verificado por leitura + as queries reais dos arquivos, não por inferência:

- **Criação:** só pelo trigger (dono) ou pela varredura de lembretes (`service_role`) — nunca por um client direto (sem policy de INSERT para `authenticated`).
- **Leitura:** `layout.tsx` busca as 8 mais recentes + contador de não lidas (`count: "exact", head: true`) em paralelo, real, toda navegação do dashboard. `/dashboard/notifications` busca até 100.
- **Unread/read:** `read_at is null` é o critério em toda query; marcar como lida é um `UPDATE` real escopado a `recipient_user_id = user.id` (redundante com a RLS, mesmo padrão de defesa em profundidade do resto do app).
- **Contador:** `count: "exact", head: true` — não traz linhas, só a contagem; exibido com cap visual "9+".
- **Ordenação:** `created_at desc` nas duas telas.
- **Persistência:** nunca apagada — só `read_at` muda.
- **RLS:** confirmada ao vivo (seção 2).
- **Muitas notificações:** lista rola (`max-h-96 overflow-y-auto` no sininho); página completa pagina implicitamente por `limit(100)` (sem paginação real além disso — se um dono acumular mais de 100, as mais antigas somem da tela, não do banco; não testado com volume real, mas é comportamento esperado do código, não um bug).
- **Nenhuma:** mensagem própria em ambas as telas ("Nenhuma notificação ainda...").
- **Erro:** nenhum tratamento de erro visível nas queries (`{ data }` sem checar `{ error }` em `layout.tsx`/`notifications/page.tsx`) — se a query falhar, `data` vem `undefined` e o código já trata isso com `?? []`/`?? 0`, então a tela degrada para "nenhuma notificação" em vez de quebrar, mas **o erro em si nunca é logado** (diferente do padrão `logError()` usado em toda action de escrita do resto do app). Achado BAIXO, não documentado antes.
- **UI realmente conectada ao banco?** Sim, confirmado — não é estrutura visual vazia em nenhum ponto.

---

## 5. WHATSAPP

- **Provedor:** WhatsApp Cloud API (Meta), classe `WhatsAppProvider`.
- **Chamada real:** `POST https://graph.facebook.com/v20.0/{phoneNumberId}/messages`, com `Authorization: Bearer {accessToken}`, timeout de 10s (`AbortController`).
- **Tratamento de erro:** mapeamento explícito de status HTTP → motivo seguro (`401/403`→`invalid_token`, `400/404`→`invalid_recipient`, `429`→`rate_limited`, resto→`provider_unavailable`; timeout→`timeout`). Nunca vaza o corpo da resposta do Meta.
- **Validação antes da rede:** `normalizePhone()` rejeita qualquer coisa que não tenha 10-15 dígitos, sem sequer chamar a API.
- **Retry:** ver seção 7 (compartilhado com e-mail).
- **Logs:** `process-notifications` nunca loga `row.recipient` nem `row.payload` (comentário explícito no código, confirmado).
- **Status de entrega:** vive em `notification_deliveries.status`.
- **Webhook (de entrada, do Meta):** **não existe.** Nada no repositório recebe callbacks de status de entrega do WhatsApp (`delivered`/`read`) — o sistema só sabe se a **chamada HTTP de envio** teve sucesso ou não, nunca se a mensagem foi de fato entregue/lida no celular do destinatário. Não documentado como gap antes.
- **Validação de credenciais:** só a presença (`waToken && waPhoneId`) — nunca uma chamada de "teste" contra a API real para confirmar que o token é válido antes de começar a usar.
- **Configuração por empresa:** só o destino (`whatsapp_phone`) — as credenciais (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`) são **globais da plataforma** (secrets da Edge Function), não por tenant. Ou seja: hoje só é possível operar com **um único número de WhatsApp Business para todos os clientes da SaaS** — cada empresa não tem o próprio número conectado. Isso é uma limitação de arquitetura relevante para o modelo de negócio (mensagens de todas as empresas sairiam do mesmo número), não documentada explicitamente em nenhum lugar antes desta auditoria.
- **Secrets:** nunca no banco, nunca no repositório — confirmado por leitura de `docs/NOTIFICATIONS.md`, `.env.example` (só comentários, nenhum valor) e o próprio código (`Deno.env.get(...)`).
- **Templates:** `templates.ts`, uma função pura por evento, mesmo texto usado pelo WhatsApp e pelo corpo do e-mail.

**Classificação (A-E, conforme pedido):**
- (A) Código implementado: **sim**, completo.
- (B) Mockado: **não** — a implementação real chama a API de produção do Meta.
- (C) Preparado para integração: **sim**, secrets/config documentados.
- (D) Integração funcional com credenciais reais: **não verificável neste ambiente** (sem credenciais, sem acesso de rede de saída para `graph.facebook.com` neste sandbox).
- (E) Nunca testado externamente: **confirmado** — os únicos testes (`whatsapp.test.ts`) usam `vi.stubGlobal("fetch", ...)`, zero chamada de rede real em qualquer momento verificável neste repositório.

**Não afirmo que o WhatsApp funciona em produção.** O código está pronto; o envio real nunca foi comprovado.

---

## 6. E-MAIL

Mesma estrutura, mesmo veredito de classificação que o WhatsApp:

- **Provedor:** Resend, `POST https://api.resend.com/emails`, `Authorization: Bearer {apiKey}`.
- **Remetente:** `EMAIL_FROM_ADDRESS` — secret global da Edge Function (mesma limitação de "um remetente único para toda a plataforma" do WhatsApp, mesma observação sobre domínio verificado no Resend).
- **Validação:** regex simples de formato de e-mail antes de qualquer chamada de rede (`isLikelyEmail`).
- **Erro:** mesmo mapeamento de status HTTP (`401/403`→invalid_token, `400/422`→invalid_recipient, `429`→rate_limited).
- **Corpo:** texto puro (`text: message.body`) — **sem HTML**, confirmado no comentário do próprio `templates.ts` ("no HTML template yet").
- **Isolamento entre tenants:** o destinatário (`notify_email_address`) vem de `business_settings` de uma única empresa por linha da fila (`business_id` presente em toda linha) — não há como uma empresa "vazar" para o e-mail de outra através deste caminho, confirmado pela query do worker não filtrar por tenant (ele processa a fila inteira, mas cada linha já carrega o destinatário certo, gravado pelo trigger da própria empresa).
- **(A-E):** implementado (A), não mockado (B=não), preparado (C=sim), funcional com credenciais reais (D) **não verificável aqui**, nunca testado externamente (E) **confirmado** — `email.test.ts` também só mocka `fetch`.

---

## 7. RETRY / FALHAS (mecanismo compartilhado WhatsApp + e-mail)

Lido `retry.ts` por completo:

- `MAX_ATTEMPTS = 5`.
- Backoff exponencial fixo: 1min → 5min → 20min → 60min → 60min (a partir da 4ª tentativa, satura em 60min, nunca aumenta além disso).
- Motivos **não-retentáveis** (`invalid_token`, `invalid_recipient`) vão direto para `failed` na primeira tentativa — não desperdiça as 5 tentativas com um erro que nunca vai se resolver sozinho.
- Todo o resto (`timeout`, `provider_unavailable`, `rate_limited`, `unknown_error`) segue para `retrying` até esgotar `MAX_ATTEMPTS`.
- `decideDeliveryOutcome()` é uma função pura (recebe `now` injetado) — testável sem rede, sem banco; 8 testes cobrindo cada transição (`dispatch.test.ts` + `retry.test.ts`, todos passando, confirmado rodando `npx vitest run` nesta auditoria).
- `dispatchDelivery()` nunca deixa uma exceção do provider escapar — um `throw` inesperado vira `provider_unavailable`, garantindo que um item ruim no lote nunca derruba o resto (`process-notifications` também tem seu próprio `try/catch` por linha, redundante de propósito).

**Nenhuma falha de desenho encontrada neste mecanismo.**

---

## 8. LEMBRETES (24h / 2h)

- **Janelas:** 23h-24h e 1h50-2h antes — deliberadamente estreitas (evita mandar "amanhã" para um agendamento feito com poucas horas de antecedência).
- **Timezone:** `toLocaleDateString/toLocaleTimeString` com `timeZone: business.timezone` — consistente com o resto do sistema.
- **Cancelados/reagendados:** a query filtra `status in ('pending','confirmed')` — um agendamento cancelado ou concluído **nunca** entra na varredura, nem recebe lembrete depois de mudar de status. Confirmado por leitura direta da query (`.in("status", ["pending","confirmed"])`).
- **Duplicação/idempotência:** dois mecanismos independentes — (1) a query só traz linhas com a coluna `sentColumn` (`reminder_24h_sent_at`/`reminder_2h_sent_at`) nula; (2) a função grava esse timestamp **antes** de decidir se vai notificar algo ("Always stamp the appointment first" no próprio código) — mesmo que a function rode 2x em paralelo ou o dono tenha todos os canais desligados, o mesmo lembrete nunca é reprocessado. **Ressalva não documentada antes:** o `UPDATE` do stamp e o `INSERT` de `notifications`/`notification_deliveries` não estão dentro de uma transação explícita no código do Edge Function (cada chamada `supabase.from(...)` é sua própria operação) — sob duas execuções **genuinamente simultâneas** do mesmo agendamento, existe uma janela teórica entre o `UPDATE` do stamp e os `INSERT`s seguintes onde uma segunda execução já veria o stamp preenchido (proteção efetiva), mas a primeira execução ainda não teria inserido a notificação — nesse caso raríssimo (dois cron disparando no mesmo segundo para o mesmo agendamento), o resultado seria "stamp gravado, mas nenhuma notificação criada por nenhuma das duas", não uma duplicata. Ou seja: o mecanismo erra para o lado seguro (nunca duplica), na pior hipótese apenas pula um lembrete — não é uma vulnerabilidade, é uma característica de design (idempotência sobre garantia de entrega), mas vale registrar que não é atômico.
- **Corrida entre workers:** ver ressalva acima — não há lock explícito, mas o resultado no pior caso é "pula", nunca "duplica".
- **Agendamento inexistente/apagado:** não é possível hoje — `appointments` nunca é fisicamente deletada pela aplicação (confirmado em auditorias anteriores e reconfirmado aqui, `grep` por `.delete()` em `appointments` não aparece em nenhum código da aplicação).
- **Falha no envio:** cai no mesmo mecanismo de retry da seção 7 — a criação da linha na fila (`notification_deliveries`) é sempre bem-sucedida (é um insert local); só o envio de fato pode falhar, depois, no `process-notifications`.
- **Scheduler:** **não existe em nenhuma migration.** `docs/NOTIFICATIONS.md` documenta o passo manual (`pg_cron`/`pg_net` via SQL Editor). Aplicar só as migrations deste repositório **não deixa os lembretes rodando sozinhos** — confirmado, nenhuma mudança desde `AUDIT-07`.

---

## 9. EDGE FUNCTIONS

### `process-notifications`

| Campo | Valor |
| --- | --- |
| Finalidade | Drena `notification_deliveries` (`pending`/`retrying` com `next_attempt_at` vencido), até 50 por execução |
| Entrada | `POST`, sem corpo relevante (nenhum parâmetro do chamador é usado) |
| Autenticação | `Authorization: Bearer {CRON_SECRET}` comparado a uma env var; sem o secret certo **ou sem o secret configurado no ambiente**, `401` |
| Autorização | Nenhuma granularidade além de "tem o secret ou não" — não há conceito de "processar só a empresa X" |
| Secrets usados | `CRON_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (as duas últimas injetadas automaticamente pelo runtime da Edge Function) |
| Tabelas acessadas | Só `notification_deliveries` (select + update) — **nunca `appointments`**, por desenho (garantia arquitetural de que uma falha aqui não pode tocar um agendamento) |
| Funções SQL usadas | Nenhuma — só `.from(...).select/update(...)` do client JS |
| Provider externo | WhatsApp Cloud API e/ou Resend, condicionalmente (só se as credenciais daquele canal estiverem presentes) |
| Resposta | JSON `{ processed, sent, retrying, failed }` |
| Tratamento de erro | Por linha, `try/catch` — uma linha ruim não derruba o lote. Erro de `fetchError` na consulta inicial → `500` |
| Retry | Delegado a `dispatchDelivery`/`decideDeliveryOutcome` (seção 7) — a Edge Function em si não decide retry, só persiste o resultado |
| Idempotência | Uma execução processa até 50 linhas e as marca; reexecutar imediatamente não reprocessaria as que já viraram `sent`/`failed`/ainda estão em `retrying` com `next_attempt_at` no futuro |
| Logs | `console.error` estruturado (JSON), nunca `row.recipient`/`row.payload` |

### `appointment-reminders`

| Campo | Valor |
| --- | --- |
| Finalidade | Varre `appointments` próximas do lembrete de 24h/2h e enfileira (não envia) |
| Entrada | `POST`, sem corpo relevante |
| Autenticação | Mesmo esquema `CRON_SECRET` |
| Autorização | Mesma observação — "tudo ou nada", roda para todas as empresas de uma vez (uso legítimo de `service_role`, já confirmado como correto em `AUDIT-09`) |
| Secrets usados | `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **não** usa credenciais de WhatsApp/e-mail diretamente (só enfileira, quem envia é a outra function) |
| Tabelas acessadas | `appointments` (select + update do stamp), `businesses`, `business_settings`, `customers`, `services`, `professionals`, `business_members`, `notifications` (insert), `notification_deliveries` (insert) — todas via `service_role` |
| Funções SQL usadas | Nenhuma RPC — só queries diretas |
| Provider externo | Nenhum diretamente — só cria as linhas que `process-notifications` depois processa |
| Resposta | JSON `{ "24h": n, "2h": n }` (contagem de lembretes enfileirados) |
| Tratamento de erro | Por agendamento, `try/catch`, log estruturado sem PII |
| Retry | Não aplicável a esta function (ela não tenta reenviar nada, só enfileira uma vez, protegida pela idempotência da seção 8) |
| Idempotência | Ver seção 8 (dupla proteção) |
| Logs | `appointment_id`/`business_id`/`kind`/mensagem de erro — nunca nome de cliente/empresa |

**Nenhuma das duas functions foi alterada durante esta auditoria.**

---

## 10. BILLING / FEATURE GATING

- **Feature:** `advanced_notifications`, definida em `src/lib/plans/config.ts` — presente nos planos `pro` e `business`, **ausente** no `start`.
- **Onde o bloqueio acontece:** `src/app/dashboard/settings/actions.ts`, função `updateNotificationSettings` — **só** quando `whatsapp_enabled` ou `notify_email_enabled` estão sendo ligados (`if (parsed.data.whatsapp_enabled || parsed.data.notify_email_enabled) { canUseFeature(...) }`). É a **única** checagem de plano em todo o fluxo de notificações.
- **Frontend:** `notification-settings-form.tsx` não esconde nem desabilita os checkboxes para um plano `start` — o formulário é idêntico para todos os planos; o erro só aparece depois de tentar salvar.
- **Backend (Server Action):** aplicado corretamente, com teste unitário de suporte (`evaluate.test.ts`, casos para `advanced_notifications` em `start`/`pro`, `enforced=true/false`).
- **Banco (RLS/constraint):** **nenhum**. `business_settings_update_owner` permite ao dono atualizar **qualquer coluna**, incluindo `whatsapp_enabled`/`notify_email_enabled`, sem checar `subscriptions.plan_id` em lugar nenhum.
- **Bypass possível:** **sim, confirmado por leitura de código** (RLS + grant já testados ao vivo em auditorias anteriores para esta mesma tabela/policy) — um dono autenticado pode chamar a REST API do Supabase diretamente (`PATCH /rest/v1/business_settings?business_id=eq.<próprio id>` com `{"whatsapp_enabled": true}`, usando a própria sessão) e o banco aceita, porque a única verificação de plano vive na Server Action do Next.js, não na política de RLS nem em nenhum `check`/trigger. Ver severidade e reprodução completa na seção 11.
- **O banco permite uma ação que deveria ser bloqueada?** **Sim** — esse é exatamente o achado acima.
- **Nuance adicional (fail-open documentado, não um bug):** `evaluate.ts` só **enforça** limites quando `subscriptions.status in ('trialing', 'active')` — `past_due`/`canceled`/`incomplete`/sem assinatura alguma **sempre** deixam passar (`isLimitEnforced` retorna `false`), por decisão de produto explícita ("billing sendo não configurado, em setup, ou com problema nunca deve trancar o dono fora do próprio painel"). Consequência direta para notificações: mesmo sem o bypass acima, uma empresa com assinatura `past_due`/`canceled` pode ligar WhatsApp/e-mail passando pela própria tela normalmente — o paywall de `advanced_notifications` só é realmente exigido enquanto a assinatura está `trialing`/`active`.
- **Uma vez ligado, nada revalida:** nem `process-notifications` nem `appointment-reminders` consultam `subscriptions`/plano antes de processar uma linha da fila — se uma empresa ligou WhatsApp num momento em que tinha direito (ou contornou o gate) e depois deixa de ter, os envios continuam indefinidamente até o dono desligar manualmente.

---

## 11. SEGURANÇA — achados

### ACHADO 1 — Gate de plano (`advanced_notifications`) só na aplicação, não no banco

- **SEVERIDADE:** MÉDIA (integridade de billing/produto — não é vazamento entre tenants, é uma empresa acessando um recurso pago sem pagar).
- **ARQUIVO:** `src/app/dashboard/settings/actions.ts` (única checagem) vs. `supabase/migrations/20250924120004_rls.sql` (policy `business_settings_update_owner`, sem checagem de plano) + `supabase/migrations/20250924120007_notifications.sql` (colunas `whatsapp_enabled`/`notify_email_enabled`, sem `check` ligado a plano).
- **LOCALIZAÇÃO:** `updateNotificationSettings()`, linhas 80-85 do arquivo de actions.
- **CENÁRIO:** Um dono de empresa no plano Start, autenticado no dashboard (tem uma sessão Supabase válida no navegador), abre o DevTools e chama a REST API do Supabase diretamente com sua própria chave anon + JWT, em vez de usar o formulário.
- **IMPACTO:** Recurso vendido como exclusivo dos planos Pro/Business (WhatsApp + e-mail) passa a funcionar de fato para uma conta Start, sem upgrade — perda de receita potencial, não uma falha de isolamento entre empresas (cada uma só mexe na própria linha).
- **COMO REPRODUZIR (contra um ambiente de teste, nunca produção):**
  ```
  fetch("https://<projeto>.supabase.co/rest/v1/business_settings?business_id=eq.<próprio_business_id>", {
    method: "PATCH",
    headers: {
      apikey: "<anon key pública>",
      Authorization: "Bearer <jwt da própria sessão>",
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ whatsapp_enabled: true, whatsapp_phone: "+55..." }),
  });
  ```
  RLS aceita porque quem faz a chamada é o próprio `is_business_owner()`; não há nenhuma outra checagem no caminho.
- **CORREÇÃO RECOMENDADA:** adicionar uma segunda camada no banco — ou (a) um trigger `BEFORE UPDATE` em `business_settings` que rejeita `whatsapp_enabled`/`notify_email_enabled = true` quando a assinatura associada não tem o feature (replicando `evaluateFeatureAccess` em SQL), ou (b) mover a escrita dessas duas colunas específicas para uma função `SECURITY DEFINER` (`update_notification_channels(...)`) que faz a mesma checagem de plano do lado do banco antes de gravar, e revogar o `UPDATE` direto dessas colunas para `authenticated` (grant de coluna, mesmo padrão já usado em `businesses`). **Não implementado nesta etapa, conforme instruído.**

### ACHADO 2 — Nenhuma revalidação contínua do gate

- **SEVERIDADE:** BAIXA/MÉDIA (mesma categoria do Achado 1, efeito cumulativo com o tempo).
- **ARQUIVO:** `supabase/functions/process-notifications/index.ts`, `supabase/functions/appointment-reminders/index.ts`.
- **LOCALIZAÇÃO:** Nenhuma linha específica — é uma ausência (nenhuma consulta a `subscriptions` em nenhum dos dois workers).
- **CENÁRIO:** Empresa liga WhatsApp/e-mail legitimamente no Pro, depois faz downgrade para Start ou a assinatura cai para `past_due`/`canceled`.
- **IMPACTO:** Os canais continuam ativos e sendo processados indefinidamente — o produto continua entregando (e pagando custo de API de WhatsApp/Resend) por um recurso que a empresa não paga mais.
- **COMO REPRODUZIR:** ligar WhatsApp/e-mail num plano que permite, depois trocar `subscriptions.plan_id`/`status` (via webhook de billing ou diretamente em teste) para algo que não permite — observar que `business_settings.whatsapp_enabled` permanece `true` e a fila continua sendo processada normalmente.
- **CORREÇÃO RECOMENDADA:** no webhook de billing (`src/lib/billing/apply-event.ts`) ou num job periódico, desligar `whatsapp_enabled`/`notify_email_enabled` quando o plano efetivo deixa de incluir `advanced_notifications`. **Não implementado nesta etapa.**

### ACHADO 3 — Sem webhook de status de entrega do WhatsApp

- **SEVERIDADE:** BAIXA (limitação de produto, não uma vulnerabilidade).
- **ARQUIVO:** N/A — ausência de funcionalidade.
- **CENÁRIO/IMPACTO:** `status = 'sent'` só significa "a Cloud API aceitou a requisição HTTP", nunca "a mensagem chegou/foi lida". Sem um endpoint de webhook para os callbacks de status do Meta, o sistema não tem como saber se uma entrega "sent" na verdade falhou do lado do WhatsApp (número bloqueou a empresa, etc.).
- **CORREÇÃO RECOMENDADA:** endpoint de webhook dedicado (Route Handler, mesmo padrão de `api/webhooks/billing/[provider]`) para os callbacks de status do WhatsApp Cloud API, se granularidade de entrega for um requisito real de produto.

### Confirmações positivas (testadas ao vivo, sem achado)

- Isolamento entre tenants de `notifications`/`notification_deliveries`: **100% bloqueado** em todas as tentativas (select cross-tenant, update cross-tenant, insert direto, update de status direto) — ver seção 2.
- `anon` nunca lê nada dessas duas tabelas.
- Nenhuma credencial (WhatsApp token, Resend key, `CRON_SECRET`) exposta no banco, no repositório, ou em qualquer arquivo `"use client"` — confirmado por grep dedicado (`grep -rln "WHATSAPP_ACCESS_TOKEN\|RESEND_API_KEY\|CRON_SECRET" src/`) → zero ocorrências fora de comentários/documentação.
- `last_error`/`payload` nunca guardam dado sensível além do que já é necessário para o template (nome do cliente, serviço, data) — confirmado lendo o `check`/comentário da coluna e o código que a popula.
- Nenhum endpoint permite disparar uma mensagem arbitrária para um destinatário arbitrário — a única forma de uma linha existir em `notification_deliveries` é através do trigger (dados vêm de `business_settings`/`customers` reais) ou da varredura de lembretes (mesma origem); não há RPC pública nem Server Action que aceite `{channel, recipient, payload}" livre.

---

## 12. TESTES EXECUTADOS NESTA AUDITORIA

```
npx vitest run supabase/functions/_shared/notifications
  → 5 arquivos, 33 testes, 100% passando (dispatch, retry, templates, whatsapp, email)
```

Confirmado que todos usam `vi.stubGlobal("fetch", ...)` — nenhuma chamada de rede real.

**SQL, ao vivo, Postgres 16 descartável (14 migrations aplicadas), nunca produção:**

1. Criar agendamento com WhatsApp+e-mail habilitados → 1 notificação + 2 linhas de fila (`pending`, `appointment.created`).
2. Cancelar esse mesmo agendamento via `cancel_public_appointment()` (RPC pública da Etapa 3) → +1 notificação, +2 linhas de fila (`appointment.cancelled`) — confirma a integração automática entre Etapa 3 e o sistema de notificações, nunca testada antes por não existir quando `AUDIT-07` foi escrita.
3. Owner B lendo/marcando notificações e deliveries de Owner A → 0 linhas afetadas em todos os casos.
4. `anon` lendo `notifications`/`notification_deliveries` → 0 linhas.
5. Owner A tentando `INSERT`/`UPDATE` diretamente em `notification_deliveries` → bloqueado nos dois casos (RLS sem policy de escrita para `authenticated`).
6. Owner A lendo suas próprias `notification_deliveries` → 4 linhas corretas.

Nenhuma alteração de código foi necessária ou feita para nenhum desses testes — todos passaram na primeira tentativa contra o schema atual.

---

## 13. RESUMO POR CLASSIFICAÇÃO PEDIDA

| Item | O que já existe | O que funciona | Só localmente | Parcial | Só arquitetado | Quebrado | Falta para produção |
| --- | --- | --- | --- | --- | --- | --- | --- |
| In-app (bell + página) | Completo | Sim, conectado de ponta a ponta ao banco | — | — | — | Não | Erro de leitura não logado (BAIXO) |
| Fila `notification_deliveries` | Completo | Sim (schema, RLS, trigger) | — | — | — | Não | — |
| Trigger de eventos | Completo | Sim, inclusive com a Etapa 3 (confirmado ao vivo) | — | — | — | Não | Risco latente de dois campos mudando juntos (documentado, não ativo) |
| WhatsApp Cloud API | Código completo | Lógica sim; envio real **nunca verificado** | Testes só com fetch mockado | — | — | Não | Testar com credenciais reais; token único para toda a plataforma (não por tenant); sem webhook de status de entrega |
| E-mail (Resend) | Código completo | Idem WhatsApp | Idem | — | — | Não | Idem (testar de verdade; remetente único da plataforma) |
| Lembretes 24h/2h | Código completo | Enfileiramento sim, idempotente | — | — | Scheduler (`pg_cron`) é passo manual fora de qualquer migration | Não | Configurar `pg_cron`/`pg_net` no projeto real |
| Retry/backoff | Completo | Sim, testado (unitário) | — | — | — | Não | — |
| Feature gating (`advanced_notifications`) | Lógica completa e testada | Só na Server Action | — | Sim — falta a camada de banco | — | Não (é uma lacuna, não um crash) | Gate no banco (Achado 1); revalidação contínua (Achado 2) |
| Edge Functions | Completo | Sim, idempotentes, com autenticação | — | — | Deploy/scheduler são passos manuais | Não | `supabase functions deploy` + `cron.schedule` reais |

---

## RECOMENDAÇÕES (nenhuma implementada nesta etapa)

1. Fechar o Achado 1 (gate de plano no banco, não só na Server Action) antes de cobrar de verdade pelo plano Pro por causa de notificações avançadas.
2. Fechar o Achado 2 (desligar canais automaticamente num downgrade/cancelamento) — ou decidir conscientemente que "fail open" também vale aqui, documentando a decisão como já é feito para `isLimitEnforced`.
3. Testar de fato, uma vez, com credenciais reais de WhatsApp Business API e Resend, antes de anunciar essas duas integrações como funcionais para o cliente final.
4. Decidir se cada empresa precisa do próprio número de WhatsApp/remetente de e-mail (mudança de arquitetura: credenciais por tenant, não globais da plataforma) ou se um número/remetente compartilhado é aceitável para o modelo de negócio.
5. Automatizar a verificação de que os `cron.schedule` esperados existem no projeto Supabase de destino (já recomendado em `AUDIT-07`, ainda não feito).
6. Se granularidade de entrega do WhatsApp for um requisito, implementar o webhook de status (Achado 3).
7. Adicionar `logError()` (ou equivalente) nas duas queries de leitura de notificações no dashboard, hoje silenciosas em caso de erro.
