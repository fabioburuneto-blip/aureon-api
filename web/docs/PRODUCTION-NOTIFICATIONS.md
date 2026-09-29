# Checklist de produção — Notificações

Este documento é o passo-a-passo operacional para colocar o sistema de
notificações (in-app, WhatsApp, e-mail, lembretes) rodando de verdade num
projeto Supabase de produção. Nada aqui é aplicado automaticamente por uma
migration — são ações manuais, feitas uma vez por projeto, fora do
repositório. Para entender a arquitetura em si (o que cada peça faz e por
quê), veja `docs/NOTIFICATIONS.md`; este documento é só o "como ligar".

**Nenhum valor real de secret aparece neste arquivo.** Todo exemplo abaixo
usa placeholder.

## 1. O que já vem pronto só de aplicar as migrations

Aplicar `supabase/migrations/*.sql` (via `supabase db push` ou o pipeline
de deploy do projeto) já deixa prontos, sem nenhum passo manual adicional:

- as tabelas `notifications` e `notification_deliveries`, com RLS;
- o trigger `trg_appointments_notify` (cria notificação in-app + enfileira
  entregas a cada evento de agendamento);
- o trigger `trg_business_settings_notification_gate` e a função
  `is_advanced_notifications_allowed()` (gate de plano — Etapa 4);
- o painel in-app (sininho + `/dashboard/notifications`) — não depende de
  nenhuma credencial externa, funciona no primeiro deploy.

O que **não** vem pronto sozinho, e é o assunto do resto deste documento:
as Edge Functions precisam ser publicadas, os secrets precisam ser
configurados, e algo precisa chamar essas funções periodicamente.

## 2. Publicar as Edge Functions

```bash
supabase functions deploy process-notifications
supabase functions deploy appointment-reminders
```

Sem isso, os endpoints `https://SEU-PROJECT-REF.supabase.co/functions/v1/process-notifications`
e `.../appointment-reminders` simplesmente não existem — qualquer chamada
retorna 404, e a fila (`notification_deliveries`) só acumula linhas
`pending` para sempre, sem nunca ser processada. O painel in-app continua
funcionando normalmente (ele não depende dessas funções).

## 3. Configurar os secrets (Edge Function secrets — nunca no `.env.local`)

```bash
supabase secrets set \
  CRON_SECRET=<gere com: openssl rand -hex 32> \
  WHATSAPP_ACCESS_TOKEN=<token da Meta for Developers> \
  WHATSAPP_PHONE_NUMBER_ID=<phone number id da Meta> \
  RESEND_API_KEY=<api key do Resend> \
  EMAIL_FROM_ADDRESS="Aureon Agenda <avisos@seudominio.com>"
```

| Secret | Obrigatório para | Sem ele |
| --- | --- | --- |
| `CRON_SECRET` | as duas Edge Functions responderem (qualquer chamada sem o header correto recebe `401`) | nenhuma das duas funções processa nada, mesmo chamadas manualmente |
| `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | canal WhatsApp | deliveries de WhatsApp ficam em `retrying`/`failed` com `last_error = "provider_unavailable"` — nada quebra, in-app continua funcionando |
| `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` | canal e-mail | mesmo comportamento acima, para e-mail |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente
dentro de toda Edge Function do projeto — não precisam ser configurados
manualmente.

**Nunca**: colocar qualquer um desses valores em `.env.local`, em código
do Next.js, em uma variável de ambiente do Vercel, ou em qualquer coluna
do banco. `business_settings` só guarda o destino
(`whatsapp_phone`/`notify_email_address`), nunca uma credencial.

## 4. Configurar o WhatsApp Business Cloud API (Meta)

1. Criar um app em [developers.facebook.com](https://developers.facebook.com/)
   com o produto **WhatsApp** adicionado.
2. Em **WhatsApp → API Setup**, copiar o **Temporary access token** (para
   teste) ou gerar um **token permanente** via um System User (para
   produção — o temporário expira em 24h).
3. Copiar o **Phone number ID** (não é o número de telefone em si, é um
   ID numérico) da mesma tela.
4. Validar o número de teste enviando uma mensagem manual pela própria UI
   da Meta antes de configurar o secret — se isso não funcionar, o
   problema é de configuração da conta Meta, não do código deste projeto.
5. Definir os dois secrets (`WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`) como no passo 3 acima.

**Limitação de arquitetura, não corrigida nesta etapa**: essas credenciais
são globais da Edge Function, isto é, hoje só existe **um único número de
WhatsApp Business para toda a plataforma** — todas as empresas que usam
Aureon Agenda enviam mensagens a partir do mesmo número. Se o modelo de
negócio exigir um número por empresa, isso é uma mudança de arquitetura
(credenciais por tenant em vez de globais), fora do escopo desta etapa —
ver `docs/audit/ETAPA-4-NOTIFICATIONS-AUDIT.md`, recomendação 4.

## 5. Configurar o Resend (e-mail)

1. Criar conta em [resend.com](https://resend.com/).
2. Verificar um domínio próprio (**Domains → Add Domain**, configurar os
   registros DNS pedidos) — enviar de um domínio não verificado é
   bloqueado ou cai em spam na maioria dos provedores de e-mail do
   destinatário.
3. Gerar uma API key em [resend.com/api-keys](https://resend.com/api-keys).
4. Definir `RESEND_API_KEY` e `EMAIL_FROM_ADDRESS` (o remetente precisa
   pertencer ao domínio verificado no passo 2) como no passo 3 da seção
   anterior.

Mesma limitação de arquitetura do WhatsApp: um único remetente para toda a
plataforma, não um por empresa.

## 6. Agendar a execução (pg_cron + pg_net)

As duas Edge Functions são endpoints HTTP simples — nada nelas é cron
nativo. **Sem este passo, elas nunca rodam sozinhas.** Aplicar as
migrations não ativa nenhum agendamento (de propósito — `pg_cron` é uma
extensão do projeto, configurada uma vez, fora do fluxo de migrations
normal). No **SQL Editor** do projeto Supabase (produção, uma vez):

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

-- varre agendamentos próximos a cada 10 minutos
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

Troque `SEU_CRON_SECRET` pelo mesmo valor do secret `CRON_SECRET`
configurado no passo 3.

**Frequência recomendada**: 2 minutos para `process-notifications` (fila
de envio — quanto mais frequente, menor o atraso percebido pelo cliente
final), 10-15 minutos para `appointment-reminders` (a janela de detecção
do lembrete é de ~1h de largura — 23h-24h e 1h50-2h antes — então rodar
mais devagar que isso ainda cobre a janela com folga; rodar mais rápido
que 2-3 minutos não traz benefício e só gera carga adicional).

## 7. Como validar que está tudo funcionando

Depois dos passos 2-6, nesta ordem:

1. **Painel in-app**: já deve funcionar mesmo sem nenhum dos passos
   acima — criar um agendamento de teste e confirmar que o sininho do
   dashboard mostra a notificação. Se isso não funcionar, o problema é na
   aplicação (migrations/trigger), não em nenhuma configuração externa.
2. **Fila sendo criada**: com WhatsApp/e-mail habilitados em
   `/dashboard/settings` (exige plano Pro/Business — ver
   `docs/NOTIFICATIONS.md`, seção "Plan gate"), criar um agendamento e
   consultar `select * from notification_deliveries order by created_at desc limit 5;`
   no SQL Editor — deve haver linhas novas com `status = 'pending'`.
3. **Fila sendo processada**: chamar manualmente o endpoint uma vez para
   não esperar o cron:
   ```bash
   curl -X POST https://SEU-PROJECT-REF.supabase.co/functions/v1/process-notifications \
     -H "Authorization: Bearer SEU_CRON_SECRET"
   ```
   Resposta esperada: `{"processed": N, "sent": N, "retrying": 0, "failed": 0}`.
   Se `sent` ficar em 0 e `retrying`/`failed` subir, o provider está
   rejeitando — ver seção 8 (monitoramento) para onde olhar o motivo.
4. **Entrega de verdade**: confirmar que a mensagem chegou no WhatsApp/
   e-mail de teste usado no passo 2. **Isso nunca foi validado neste
   ambiente de desenvolvimento** (sem credenciais reais nem acesso de
   saída à internet) — é o único passo desta lista que só pode ser
   confirmado rodando contra o projeto Supabase de produção/staging real,
   com credenciais reais.
5. **Cron rodando sozinho**: depois de configurado o `cron.schedule` do
   passo 6, esperar um ciclo (2-10 minutos) sem chamar manualmente e
   confirmar que a fila continua sendo drenada. `select * from
   cron.job_run_details order by start_time desc limit 10;` mostra o
   histórico de execuções do pg_cron.

## 8. Como monitorar e identificar falhas em produção

- **Fila parada** (linhas `pending` acumulando, `created_at` cada vez mais
  antigo): sintoma de que o cron não está rodando ou o `CRON_SECRET` está
  errado. Checar `cron.job_run_details` (passo 7.5) e os logs da Edge
  Function (**Supabase Dashboard → Edge Functions → process-notifications
  → Logs**).
- **`last_error = 'provider_unavailable'` persistente**: secret ausente
  ou provider real fora do ar — não é um bug de código, é configuração ou
  incidente externo.
- **`last_error = 'invalid_token'`**: o token da Meta expirou (token
  temporário tem 24h) ou a API key do Resend foi revogada — trocar o
  secret (passo 3).
- **`last_error = 'invalid_recipient'`**: telefone/e-mail cadastrado pelo
  empresário em `/dashboard/settings` está mal formatado — orientar o
  empresário a corrigir, não é um problema do worker.
- **`last_error = 'plan_ineligible'`**: o negócio não tem mais direito a
  `advanced_notifications` (downgrade, ou nunca teve) — comportamento
  esperado desde a Etapa 4, não um erro a investigar.
- **Logs nunca contêm**: número de telefone, e-mail, nome de cliente,
  token, ou corpo de resposta do provider — por desenho
  (`supabase/functions/process-notifications/index.ts` só loga
  `delivery_id`/`channel`/`error_message` sanitizado). Se um log
  inesperadamente contiver um desses, é uma regressão a corrigir, não um
  comportamento a esperar.
- **Sem webhook de status de entrega do WhatsApp**: `status = 'sent'`
  significa apenas "a Cloud API aceitou a requisição HTTP", nunca "a
  mensagem foi entregue/lida" — não há, hoje, nenhuma forma de saber se
  uma mensagem marcada como `sent` na verdade falhou do lado do WhatsApp
  depois. Ver `docs/audit/ETAPA-4-NOTIFICATIONS-AUDIT.md`, achado 3.

## 9. Resumo — o que depende do quê

| Depende de | O quê |
| --- | --- |
| Nada externo | painel in-app, criação/cancelamento/reagendamento de agendamento, gate de plano (seções 1 e parte da 6-7 do banco) |
| Deploy do Supabase CLI | as duas Edge Functions existirem (seção 2) |
| Configuração manual no projeto Supabase (SQL Editor) | `pg_cron`/`pg_net` e os dois `cron.schedule` (seção 6) |
| Credenciais da Meta for Developers | canal WhatsApp (seção 4) |
| Credenciais do Resend + domínio verificado | canal e-mail (seção 5) |
| Nenhuma configuração da Vercel | notificações não usam nenhuma env var do Next.js/Vercel — tudo relacionado a envio vive em Edge Function secrets, não no projeto Vercel |
