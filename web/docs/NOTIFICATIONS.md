# Notificações

Sistema de notificações do empresário quando um cliente agenda, cancela,
reagenda, ou quando um horário está próximo. Três canais atrás de uma única
abstração — **in-app**, **e-mail** e **WhatsApp** — e nenhum deles nunca
bloqueia a criação/alteração de um agendamento.

## Arquitetura em uma frase

Um write na tabela `appointments` dispara um trigger no Postgres que (a)
grava a notificação in-app na mesma transação e (b) enfileira o envio de
e-mail/WhatsApp como linhas `pending`; um worker separado (Edge Function),
rodando fora da transação, é quem realmente chama as APIs externas.

```
appointment INSERT/UPDATE (dashboard ou RPC pública)
        │
        ▼ (trigger, mesma transação, nunca falha por causa de rede)
trg_appointments_notify
        │
        ├─► notifications (in-app, aparece na hora no sininho do dashboard)
        │
        └─► notification_deliveries (status = pending, uma linha por canal habilitado)
                    │
                    ▼ (fora da transação, via cron)
        process-notifications (Edge Function)
                    │
                    ├─► WhatsAppProvider.send()  ──► WhatsApp Cloud API
                    └─► EmailProvider.send()     ──► Resend
```

Por isso um agendamento **nunca** deixa de ser criado porque o WhatsApp
está fora do ar: o trigger só faz inserts locais no Postgres, nunca uma
chamada de rede. Quem chama a API externa é o worker, minutos depois, de
forma completamente desacoplada.

## Eventos

Definidos em `supabase/functions/_shared/notifications/types.ts`
(`NotificationEventType`) e replicados no `check` da coluna `type` de
`notifications` / `event_type` de `notification_deliveries`:

| Evento                        | Disparado quando                                  | Vai para WhatsApp/e-mail? |
| ------------------------------ | -------------------------------------------------- | -------------------------- |
| `appointment.created`          | um agendamento é criado (página pública)           | sim                         |
| `appointment.confirmed`        | status muda para `confirmed`                        | não (só in-app)             |
| `appointment.cancelled`        | status muda para `cancelled`                         | sim                         |
| `appointment.rescheduled`      | `starts_at`/`ends_at` mudam sem mudar o status       | sim                         |
| `appointment.completed`        | status muda para `completed`                         | não (só in-app)             |
| `appointment.no_show`          | status muda para `no_show`                           | não (só in-app)             |
| `appointment.reminder_24h`     | ~24h antes do horário (job agendado)                 | sim                         |
| `appointment.reminder_2h`      | ~2h antes do horário (job agendado)                  | sim                         |

Cada evento também respeita o toggle específico em
`business_settings` (`notify_new_appointment`, `notify_cancellation`,
`notify_reschedule`, `notify_reminder_24h`, `notify_reminder_2h`) — o
empresário desliga em `/dashboard/settings`.

## Onde vive cada parte

```
supabase/migrations/20250924120007_notifications.sql   # schema + trigger (fonte da verdade dos eventos)
supabase/functions/_shared/notifications/
  types.ts               # NotificationProvider, tipos de evento/canal/status -- sem nada específico de runtime
  templates.ts            # texto de cada evento (WhatsApp/e-mail usam o mesmo corpo)
  retry.ts                 # a máquina de estados de retry/backoff (testável isoladamente)
  dispatch.ts               # chama o provider certo e nunca deixa uma exceção escapar
  http.ts                    # fetch com timeout, usado pelos providers
  providers/
    whatsapp.ts               # WhatsApp Cloud API (Meta)
    email.ts                   # Resend
    in-app.ts                   # no-op -- o in-app já foi "entregue" pelo trigger
supabase/functions/
  process-notifications/       # worker: drena notification_deliveries pendentes
  appointment-reminders/       # worker: varre agendamentos e enfileira lembretes 24h/2h
src/app/dashboard/
  notification-bell.tsx        # sininho no header (desktop e mobile)
  notifications/                # página /dashboard/notifications (lista completa + marcar como lida)
  settings/notification-settings-form.tsx  # liga/desliga WhatsApp, e-mail e cada evento
```

Os arquivos em `_shared/notifications/` (exceto `providers/*.ts`, que só
adicionam uma chamada `fetch`) não usam nenhuma API específica de Deno ou
Node de propósito — são testados diretamente pelo Vitest do app Next.js
(`npm run test`), mesmo vivendo dentro de `supabase/functions/`.

## Trocar de fornecedor de WhatsApp/e-mail depois

Nada no resto do sistema (o trigger, o worker, o dashboard) sabe que o
fornecedor de WhatsApp é a Cloud API da Meta, ou que o de e-mail é o
Resend — eles só conhecem a interface `NotificationProvider`
(`send(input): Promise<SendResult>`). Para trocar:

1. Crie uma nova classe em `supabase/functions/_shared/notifications/providers/`
   implementando `NotificationProvider` (mesmo formato de `whatsapp.ts`).
2. Troque a construção em
   `supabase/functions/process-notifications/index.ts` (`buildProviders()`).
3. Pronto — o schema, o trigger, os templates e o dashboard não mudam.

## Onde colocar as credenciais (IMPORTANTE)

**Nunca em `.env.local`, nunca no código do app Next.js, nunca em uma
coluna do banco.** As únicas colunas relacionadas a WhatsApp/e-mail em
`business_settings` são o **destino** (`whatsapp_phone`,
`notify_email_address`) — não um token.

Credenciais reais (token da Meta, API key do Resend) são **secrets da Edge
Function**, configurados fora do banco e fora do repositório:

```bash
supabase secrets set \
  WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  WHATSAPP_PHONE_NUMBER_ID=123456789012345 \
  RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx \
  EMAIL_FROM_ADDRESS="Aureon Agenda <avisos@seudominio.com>" \
  CRON_SECRET=$(openssl rand -hex 32)
```

(ou em **Project Settings → Edge Functions → Secrets** no dashboard do
Supabase, se preferir a UI em vez da CLI).

| Secret                     | Para quê                                                          | Onde conseguir                                                                 |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`     | autentica as chamadas à WhatsApp Cloud API                           | [Meta for Developers](https://developers.facebook.com/) → seu app → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID`  | identifica o número de WhatsApp Business que envia as mensagens       | mesma tela acima ("Phone number ID", não é o número de telefone em si)            |
| `RESEND_API_KEY`            | autentica o envio de e-mail                                          | [resend.com/api-keys](https://resend.com/api-keys)                                |
| `EMAIL_FROM_ADDRESS`        | remetente dos e-mails de notificação (precisa de domínio verificado)  | configurado no próprio Resend                                                     |
| `CRON_SECRET`               | segredo compartilhado que autoriza o pg_cron a chamar as Edge Functions | gerado por você (`openssl rand -hex 32`), nunca exposto ao navegador            |

Sem `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` configurados, o
canal WhatsApp simplesmente fica em `retrying`/`failed` com
`last_error = "provider_unavailable"` — nada quebra, o empresário
continua recebendo as notificações in-app normalmente. O mesmo vale para
e-mail sem `RESEND_API_KEY`.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente
dentro de toda Edge Function — não precisam ser configurados.

## Publicar as Edge Functions

```bash
supabase functions deploy process-notifications
supabase functions deploy appointment-reminders
```

## Agendar a execução (pg_cron + pg_net)

As duas funções são endpoints HTTP simples — nada nelas é "cron nativo".
Quem as chama periodicamente é o Postgres, via `pg_cron` (agenda) +
`pg_net` (faz a requisição HTTP), ambas extensões oficiais do Supabase.
No **SQL Editor** do projeto:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- drena a fila de envios a cada 2 minutos
select cron.schedule(
  'process-notifications',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJECT-REF.supabase.co/functions/v1/process-notifications',
    headers := jsonb_build_object('Authorization', 'Bearer ' || 'SEU_CRON_SECRET'),
    timeout_milliseconds := 15000
  );
  $$
);

-- varre agendamentos próximos a cada 10 minutos (ver docs/NOTIFICATIONS.md
-- sobre a janela de 23h-24h / 1h50-2h antes de mudar essa cadência)
select cron.schedule(
  'appointment-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJECT-REF.supabase.co/functions/v1/appointment-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || 'SEU_CRON_SECRET'),
    timeout_milliseconds := 15000
  );
  $$
);
```

Troque `SEU_CRON_SECRET` pelo mesmo valor de `CRON_SECRET` configurado nos
secrets da Edge Function. É esse valor compartilhado (nunca a chave anon,
nunca a service role) que autoriza as duas funções a rodar — sem ele, ou
com o valor errado, elas respondem `401 Unauthorized`.

### Por que a janela de lembretes é 23h-24h / 1h50-2h, não "menos de 24h/2h"

Um agendamento marcado com 5 horas de antecedência tecnicamente já está "a
menos de 24h" no primeiro instante em que existe — se o lembrete de 24h
disparasse nessa condição ele mandaria "amanhã" para um horário que é hoje
à tarde. Por isso `appointment-reminders` só considera a janela estreita
em que o agendamento está *de fato* a ~1 dia (ou ~2h) de distância. Isso
implica que, se o cron ficar fora do ar por mais tempo que a janela, aquele
lembrete específico é pulado (o agendamento não perde o status, só não
recebe aquele lembrete) — o próximo agendamento processado normalmente. Por
isso a cadência recomendada é de 10-15 minutos.

## Status de entrega

Cada linha de `notification_deliveries` tem um `status`:

- **`pending`** — enfileirada, aguardando o próximo `process-notifications`.
- **`sent`** — o provedor confirmou o envio.
- **`retrying`** — falhou de forma que vale tentar de novo (indisponibilidade,
  timeout, rate limit); `next_attempt_at` tem o horário da próxima tentativa
  (backoff exponencial: 1min, 5min, 20min, 60min).
- **`failed`** — falha definitiva: ou esgotou as 5 tentativas, ou o erro é
  do tipo que não adianta tentar de novo (token inválido, destinatário
  inválido) — nesses dois casos falha já na primeira tentativa.

`last_error` guarda só uma palavra-chave segura (`timeout`,
`provider_unavailable`, `invalid_token`, `invalid_recipient`,
`rate_limited`, `unknown_error`) — nunca uma stack trace, corpo de resposta
do provedor ou o token em si. `payload` guarda apenas as variáveis do
template (nome do cliente, serviço, data/horário) — nunca dado sensível
além do que já está em `customers`/`appointments`.

O proprietário pode consultar essas linhas direto no SQL Editor do
Supabase (`select * from notification_deliveries order by created_at desc`)
para depurar um envio que não chegou — a política de RLS
`notification_deliveries_select_owner` permite leitura para o dono do
negócio.

## Testes de falha

`npm run test` cobre, sem precisar de rede nem de credenciais reais
(`supabase/functions/_shared/notifications/**/*.test.ts`):

- **provedor indisponível** (erro de rede) → `retrying`, depois `failed`
  após 5 tentativas;
- **timeout** → mesma degradação, sem nunca travar a fila;
- **token inválido** (401) → `failed` já na primeira tentativa (não adianta
  reenviar sem trocar o token);
- **número/e-mail inválido** (400/422, ou formato claramente inválido
  detectado antes de qualquer chamada de rede) → `failed` de imediato;
- **rate limit** (429) → `retrying` com backoff;
- **provider lançando exceção inesperada** → `dispatchDelivery` nunca
  propaga, sempre degrada para `provider_unavailable` em vez de derrubar o
  worker inteiro no meio de um lote.

## Painel (in-app)

- Sininho no cabeçalho do dashboard (desktop e mobile), com contador de
  não lidas, mostrando as 8 mais recentes.
- `/dashboard/notifications`: histórico completo (até 100), marcar uma ou
  todas como lidas, e clique leva direto ao agendamento relacionado.
- `notifications.recipient_user_id` escopa cada notificação ao usuário
  dono dela via RLS (`notifications_select_recipient`) — hoje isso é
  sempre o(s) proprietário(s) do negócio (o trigger notifica todo
  `business_members` com `role = 'owner'`), preparado para múltiplos donos.
