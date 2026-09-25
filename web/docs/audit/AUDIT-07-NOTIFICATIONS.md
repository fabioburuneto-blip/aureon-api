# AUDIT-07 — Notificações

Auditoria read-only. Nenhum código foi alterado. Toda afirmação sobre
transação/segurança foi verificada lendo o trigger real no banco; nenhum
provedor externo (WhatsApp/Resend) foi de fato chamado nesta auditoria —
isso está declarado explicitamente onde relevante, conforme exigido.

## Resultado

**PASS COM RESSALVAS.** A arquitetura é sólida e genuinamente separa a
escrita do agendamento do envio externo: notificação in-app e
enfileiramento de envio acontecem dentro da mesma transação do
agendamento via trigger, nunca chamando uma API externa nessa hora — o
que **garante por construção** que o agendamento nunca falha por causa
do WhatsApp/e-mail estarem fora do ar. Os provedores (WhatsApp Cloud
API, Resend) são implementações reais e completas, com timeout, retry
com backoff exponencial e classificação de erro — mas **nunca foram
testados contra a API real** nesta ou em nenhuma auditoria anterior
(apenas contra `fetch` mockado em teste unitário). O agendamento do
cron (`pg_cron`) que dispara os workers **não está em nenhuma migration**
— é um passo manual documentado, não algo que já vem funcionando ao
aplicar as migrations do repositório.

## Eventos e origem

| Evento | Dispara notificação in-app? | Dispara e-mail/WhatsApp (se habilitado)? | Origem |
| --- | --- | --- | --- |
| `appointment.created` | Sim | Sim | Trigger `trg_appointments_notify` (`AFTER INSERT`) |
| `appointment.confirmed` | Sim | **Não** (não está na lista de eventos ligados a canais externos) | Trigger (`AFTER UPDATE`, mudança de `status`) |
| `appointment.cancelled` | Sim | Sim | Trigger |
| `appointment.rescheduled` | Sim | Sim | Trigger (`AFTER UPDATE`, mudança de `starts_at`/`ends_at`) |
| `appointment.completed` | Sim | **Não** | Trigger |
| `appointment.no_show` | Sim | **Não** | Trigger |
| `appointment.reminder_24h` / `reminder_2h` | Sim | Sim (se habilitado nas configurações) | Edge Function `appointment-reminders`, não o trigger |

**A origem de todo evento ligado a agendamento é um único trigger de
banco** (`notify_appointment_event()`, `SECURITY DEFINER`), disparado
tanto por `create_public_appointment()` (cliente anônimo) quanto por
qualquer `UPDATE` feito pelo painel (`updateAppointmentStatus`,
`rescheduleAppointment`) — não há lógica duplicada de notificação no
código da aplicação, e nenhuma chance de um caminho esquecer de
notificar porque **é o mesmo gatilho para os dois casos**. Os lembretes
(24h/2h) são a exceção: eles não vêm de um evento de escrita, vêm de uma
varredura periódica separada (`appointment-reminders`).

**Achado (nuance, não documentada antes):** confirmações, conclusões e
"não compareceu" **só geram notificação in-app, nunca e-mail/WhatsApp** —
isso está explícito no comentário do próprio SQL ("Only new/cancelled/
rescheduled are wired to outbound channels for now"), não é um bug, é
uma decisão de escopo, mas vale registrar porque não estava em nenhum
documento anterior.

## Fila (notification_deliveries)

Confirmado por leitura do schema
(`20250924120007_notifications.sql:75-98`): existe uma tabela dedicada
com `status in ('pending', 'sent', 'failed', 'retrying')`,
`attempts`, `last_error` (mensagem sanitizada, nunca payload bruto do
provedor), `next_attempt_at`. Índice parcial em
`(status, next_attempt_at) where status in ('pending','retrying')` —
desenhado para o worker escanear eficientemente.

## Segurança transacional (agendamento nunca falha por causa de notificação)

**Confirmado pela própria estrutura do código, não por um teste de rede
real** (não há como derrubar a API do WhatsApp de propósito nesta
auditoria): o trigger `notify_appointment_event()` e toda a lógica de
`create_public_appointment()`/`updateAppointmentStatus`/
`rescheduleAppointment` **nunca fazem uma chamada de rede** — apenas
`insert`/`update` locais nas tabelas `notifications` e
`notification_deliveries`, dentro da mesma transação do `INSERT`/`UPDATE`
em `appointments`. O envio de fato (a única parte que toca a rede)
acontece depois, de forma assíncrona, num processo totalmente separado
(`process-notifications`), que só lê a fila — nunca a tabela
`appointments`. **Não existe nenhum caminho de código em que uma falha
de rede do WhatsApp/e-mail possa reverter ou impedir um agendamento**,
porque não existe nenhuma chamada de rede na mesma transação. Isso é
garantido pela arquitetura (fila assíncrona), não por um try/catch que
poderia ter sido esquecido em algum lugar.

## In-app

Confirmado em `src/app/dashboard/notification-bell.tsx`,
`src/app/dashboard/notifications/page.tsx` e
`src/app/dashboard/notifications/actions.ts`:

- Notificação é criada de fato (trigger, acima).
- Sininho no cabeçalho do painel, com contador de não lidas
  (`unreadCount`, `count(*) where read_at is null`, query real).
- Clique numa notificação marca como lida (`markNotificationRead`) e,
  se tiver `appointment_id`, navega para o agendamento.
- "Marcar todas como lidas" existe (`markAllNotificationsRead`).
- Histórico completo em `/dashboard/notifications` (achado de
  `AUDIT-06`: essa página não está no menu principal, só alcançável
  pelo sininho).
- RLS: cada usuário só vê/marca as próprias notificações
  (`recipient_user_id = auth.uid()`), não as de outros membros da mesma
  empresa — coerente com o comentário do schema sobre múltiplos donos.

## WhatsApp

- **Provedor:** WhatsApp Cloud API (Meta), implementado em
  `supabase/functions/_shared/notifications/providers/whatsapp.ts` —
  chamada HTTP real (`POST {apiBaseUrl}/{phoneNumberId}/messages`),
  timeout configurável (10s padrão), classificação de erro por status
  HTTP (401/403 → token inválido, 400/404 → destinatário inválido, 429 →
  rate limit, resto → indisponível), validação de formato de telefone
  antes de sequer chamar a rede.
- **Edge Function:** `process-notifications` — só instancia o provedor
  se `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` estiverem
  presentes nas secrets da function; se não estiverem, a linha da fila
  cai no branch de "nenhum provedor" e segue o fluxo normal de
  retry/falha, sem crashar.
- **Secrets:** nunca no banco, nunca no código — só em variáveis de
  ambiente da Edge Function, conforme `docs/NOTIFICATIONS.md`.
- **Templates:** existem em `_shared/notifications/templates.ts`,
  usados tanto pelo provedor quanto (duplicado, mas consistente) pelas
  mensagens in-app geradas no trigger SQL.
- **Telefone do empresário:** configurável em
  `dashboard/settings` (`whatsapp_phone`), campo dedicado — correto, é
  o número que recebe o aviso, não o do cliente.
- **Eventos cobertos:** criado/cancelado/reagendado + lembretes 24h/2h
  (ver tabela acima).
- **Tratamento de falha/retry/backoff:** real, ver seção dedicada
  abaixo.

**Classificação exigida:** **IMPLEMENTADO MAS NÃO TESTADO COM API REAL.**
O código faz uma chamada HTTP de produção de verdade para
`graph.facebook.com`, mas os únicos testes existentes
(`whatsapp.test.ts`) usam `vi.stubGlobal("fetch", ...)` — **nunca uma
chamada de rede real** foi feita contra a API do WhatsApp em nenhum
momento verificável neste repositório (nem nesta auditoria, que não tem
credenciais nem acesso de rede para isso).

## E-mail

Mesma estrutura, mesmo veredito: `EmailProvider`
(`_shared/notifications/providers/email.ts`) chama a API HTTP real da
Resend (`POST https://api.resend.com/emails`), com timeout e
classificação de erro equivalentes. Configuração de destino
(`notify_email_address`) no painel de configurações. **Classificação:
IMPLEMENTADO MAS NÃO TESTADO COM API REAL** — mesmo raciocínio do
WhatsApp; `email.test.ts` também só mocka `fetch`.

## Lembretes (24h / 2h)

Lido `supabase/functions/appointment-reminders/index.ts` por completo:

- **Janelas:** 23h-24h e 1h50-2h antes do horário do agendamento —
  deliberadamente estreitas (comentário explícito no código: uma janela
  larga poderia disparar um lembrete "de amanhã" para um agendamento
  feito com 5h de antecedência).
- **Idempotência:** confirmada por dois mecanismos independentes: (1) a
  consulta só traz agendamentos com a coluna
  `reminder_24h_sent_at`/`reminder_2h_sent_at` ainda nula; (2) a função
  **grava esse timestamp antes mesmo de decidir se vai notificar algo**
  ("Always stamp the appointment first", comentário no próprio código) —
  então mesmo se a função rodar 2x seguidas por engano, ou se o
  empresário tiver todos os canais desligados, o mesmo lembrete nunca é
  reprocessado.
- **Timezone:** `startsAt.toLocaleDateString(...)`/`toLocaleTimeString(...)`
  com `timeZone: business.timezone` — igual ao padrão usado no trigger
  principal, correto.
- **Autenticação:** exige `Authorization: Bearer <CRON_SECRET>`,
  comparado a uma variável de ambiente — sem o secret certo, `401`.
  Sem o secret configurado no ambiente, a função recusa qualquer
  chamada (`!Deno.env.get("CRON_SECRET")` também bloqueia).
- **Resiliência:** falha ao processar um agendamento (linha relacionada
  ausente, erro transitório) é capturada e logada por item, sem
  interromper a varredura dos demais.
- **Scheduler/cron:** **não existe em nenhuma migration do
  repositório.** `grep -rn "cron.schedule" supabase/migrations/` não
  retorna nada — o agendamento via `pg_cron`/`pg_net` está documentado
  em `docs/NOTIFICATIONS.md` (seção "Agendar a execução"), mas é um
  passo manual que quem faz o deploy precisa executar contra o próprio
  projeto Supabase. **Ou seja: aplicar só as migrations deste
  repositório não deixa os lembretes rodando sozinhos** — o código está
  pronto e correto, mas a ativação automática depende de uma etapa fora
  do controle de versão.

## Testes executados

1. Leitura completa de `20250924120007_notifications.sql` (trigger
   `notify_appointment_event`, tabela `notification_deliveries`,
   colunas de `business_settings`).
2. Leitura completa de `whatsapp.ts`, `email.ts`, `retry.ts`,
   `process-notifications/index.ts`, `appointment-reminders/index.ts`.
3. Leitura dos testes unitários dos provedores — confirmado que usam
   `vi.stubGlobal("fetch", ...)`, nunca uma chamada real.
4. Grep de `cron.schedule`/`pg_cron` em todas as migrations → vazio;
   confirmado como passo manual em `docs/NOTIFICATIONS.md`.
5. Leitura de `notification-bell.tsx`, `notifications/page.tsx`,
   `notifications/actions.ts`, `settings/notification-settings-form.tsx`.
6. Reconfirmação da RLS de `notifications` (escopo por
   `recipient_user_id`, não por `business_id`).

## Falhas encontradas

1. O scheduler dos lembretes não está em nenhuma migration — precisa de
   configuração manual pós-deploy para funcionar de verdade em
   produção.
2. Confirmação/conclusão/no-show não notificam por e-mail/WhatsApp (só
   in-app) — decisão de escopo válida, mas não estava documentada em
   nenhum lugar antes desta auditoria.

## Requisitos não implementados / não testados com API real

- Envio real de WhatsApp — **NÃO TESTADO COM API REAL** (código pronto).
- Envio real de e-mail — **NÃO TESTADO COM API REAL** (código pronto).
- Ativação automática do cron de lembretes/fila — depende de passo
  manual fora das migrations.

## Recomendações

1. Antes de ir para produção, testar de fato o envio com credenciais
   reais de WhatsApp Business API e Resend (mesmo que um único envio de
   verificação), documentando o resultado.
2. Considerar adicionar ao processo de deploy (não necessariamente a
   uma migration, já que `cron.schedule` normalmente roda fora do
   controle de versão de schema) um passo de verificação automatizada
   de que os `cron.schedule` esperados existem no projeto Supabase de
   destino, para não descobrir a ausência deles só quando um lembrete
   nunca chega.
3. Se a decisão de excluir confirmação/conclusão/no-show dos canais
   externos for definitiva, documentar isso explicitamente em
   `docs/NOTIFICATIONS.md` (hoje só está no comentário do SQL).
