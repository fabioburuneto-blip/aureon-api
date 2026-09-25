# Planos e assinaturas

Sistema de billing modular: os planos (preço, limites, recursos) vivem num
único arquivo de configuração, o provedor de cobrança é uma abstração
trocável, e o app inteiro funciona sem nenhum provedor real configurado
("modo local"). Nada trava o MVP por falta de billing.

## Arquitetura em uma frase

`subscriptions` é escrita **apenas** por `create_business()` (na criação) e
pelo endpoint de webhook (a cada mudança real de cobrança) — o dashboard e
os server actions só leem; nenhum formulário do app consegue alterar
status, plano pago ou período diretamente.

```
Dono escolhe um plano em /dashboard/plano
        │
        ▼
startCheckoutAction() → getBillingProvider().createCheckoutSession()
        │                         │
        │                         ├─ 'local': aplica na hora (sem cobrança real)
        │                         └─ real: redireciona para o checkout do provedor
        ▼
Provedor processa o pagamento e chama de volta:
        │
        ▼
POST /api/webhooks/billing/{provider}
        │
        ├─ verifica assinatura (rejeita se inválida)
        ├─ registra o evento em billing_webhook_events (idempotência)
        └─ aplica em subscriptions via applyBillingWebhookEvent()
```

## Onde vive cada parte

```
src/lib/plans/
  config.ts        # PLANS -- a única fonte de preço/limites/recursos de cada plano
  evaluate.ts        # lógica pura de canUseFeature/canAddX (testável sem banco)
  limits.ts             # busca a assinatura + chama evaluate.ts (usado pelos server actions)
src/lib/billing/
  types.ts          # BillingProvider -- a abstração que tudo usa
  crypto.ts           # HMAC + comparação em tempo constante
  apply-event.ts        # única função que escreve em subscriptions (idempotente)
  providers/
    local.ts               # modo dev -- sem provedor real, aplica na hora
    mercadopago.ts            # Mercado Pago (preapproval)
    stripe.ts                   # Stripe (Checkout Sessions + subscriptions)
    asaas.ts                       # Asaas
  index.ts          # getBillingProvider() -- resolve o provedor ativo a partir do .env
src/app/api/webhooks/billing/[provider]/route.ts  # endpoint público do webhook
src/app/dashboard/plano/                            # UI: plano atual + comparação + trocar/cancelar
supabase/migrations/20250924120008_billing.sql       # schema
```

## Planos

Definidos uma única vez em `src/lib/plans/config.ts` -- preço, limites e
recursos nunca são hardcoded em um componente. Mudar um limite ou preço é
uma linha nesse arquivo, não uma caça por todo o dashboard.

| Plano    | Profissionais | Serviços | Recursos                                            |
| -------- | -------------- | -------- | ----------------------------------------------------- |
| Start    | 1              | 10       | Página pública, agenda, serviços, clientes             |
| Pro      | 5              | 50       | Tudo do Start + notificações WhatsApp/e-mail            |
| Business | ilimitado      | ilimitado | Tudo do Pro + domínio próprio + múltiplas unidades (futuro) |

`plan_id` é texto livre no banco (não um enum Postgres) validado contra
`PLAN_IDS` na aplicação — adicionar um quarto plano nunca exige uma
migration, só editar `config.ts` (e o `check constraint` em
`subscriptions.plan_id`, que existe apenas como um guarda-corpo contra
erro de digitação, não como fonte da verdade).

## Banco: `subscriptions`

| Coluna                      | Quem escreve                                          |
| ---------------------------- | ------------------------------------------------------- |
| `plan_id`, `status`          | `create_business()` na criação; o webhook depois disso  |
| `provider`                   | idem                                                     |
| `provider_customer_id`       | webhook, ou `startCheckoutAction()` logo após o checkout |
| `provider_subscription_id`   | idem                                                     |
| `current_period_start/end`   | webhook                                                  |
| `cancel_at_period_end`       | webhook                                                  |

Não existe policy de RLS de `UPDATE`/`INSERT` para `authenticated` nessa
tabela -- só `SELECT` (`subscriptions_select_owner`). Isso é reforçado no
banco, não só na aplicação: uma tentativa de update pelo cliente autenticado
falha com "permission denied" antes mesmo de qualquer policy ser avaliada
(validado rodando de verdade contra um Postgres local, junto com o restante
do schema desta migration -- unicidade de `provider_subscription_id`,
idempotência de `billing_webhook_events`, e o seed de trial em
`create_business()`).

Toda escrita real passa pelo cliente **service role**
(`src/lib/supabase/admin.ts`), usado exclusivamente por:
1. o endpoint de webhook, depois de verificar a assinatura;
2. `LocalBillingProvider`, que *é* o "webhook" do modo local;
3. `startCheckoutAction()`, só para preencher `provider_customer_id`/
   `provider_subscription_id` logo após uma chamada bem-sucedida ao
   provedor (nunca status/plano/período -- isso continua sendo só o
   webhook).

## Status suportados

`trialing`, `active`, `past_due`, `canceled`, `incomplete` -- ver
`SubscriptionStatus` em `src/types/database.ts`. Os helpers de limite
(`src/lib/plans/evaluate.ts`) só **aplicam** limites quando o status é
`trialing` ou `active`; qualquer outro estado (inclusive nenhuma assinatura
encontrada) libera acesso -- ver "Restrições" abaixo.

## Modo local/desenvolvimento

Sem `BILLING_PROVIDER` definido no `.env`, `getBillingProvider()` sempre
retorna `LocalBillingProvider`. `create_business()` já seed a assinatura
nesse modo (`provider = 'local'`, plano `start`, status `trialing`, 14 dias).

Nesse modo, escolher um plano em `/dashboard/plano` aplica a mudança
imediatamente (sem redirecionar para lugar nenhum, sem cobrança real) --
é assim que se testa a UI de planos, os limites por plano e o fluxo de
cancelamento sem precisar de conta em nenhum provedor.

## Habilitando cobrança real

1. Escolha um provedor e configure as variáveis correspondentes no
   ambiente de produção (nunca em `.env.local` versionado):

   ```bash
   BILLING_PROVIDER=mercadopago
   MERCADOPAGO_ACCESS_TOKEN=...
   MERCADOPAGO_WEBHOOK_SECRET=...
   ```

   ou

   ```bash
   BILLING_PROVIDER=stripe
   STRIPE_SECRET_KEY=...
   STRIPE_WEBHOOK_SECRET=...
   STRIPE_PRICE_IDS={"start":"price_...","pro":"price_...","business":"price_..."}
   ```

   ou

   ```bash
   BILLING_PROVIDER=asaas
   ASAAS_API_KEY=...
   ASAAS_WEBHOOK_TOKEN=...
   ```

   Veja `.env.example` para a lista completa. `SUPABASE_SERVICE_ROLE_KEY`
   já precisa estar configurada de qualquer forma (webhook + modo local).

2. Registre a URL do webhook no painel do provedor:
   `https://SEU-DOMINIO/api/webhooks/billing/{provider}` -- troque
   `{provider}` por `mercadopago`, `stripe` ou `asaas` conforme o que você
   ativou. O endpoint recusa (`404`) qualquer nome de provedor diferente do
   configurado em `BILLING_PROVIDER`, então um webhook de teste do Stripe
   nunca é processado com o adaptador errado.

3. **Mercado Pago**: no painel do app, em "Notificações" (webhooks), aponte
   para a URL acima e copie a "Assinatura secreta" para
   `MERCADOPAGO_WEBHOOK_SECRET`. `MERCADOPAGO_ACCESS_TOKEN` vem de
   "Credenciais de produção".

4. **Stripe**: `stripe listen` (dev) ou **Developers → Webhooks → Add
   endpoint** (produção) apontando para a URL acima, eventos
   `customer.subscription.*`. O "Signing secret" gerado vai em
   `STRIPE_WEBHOOK_SECRET`. `STRIPE_PRICE_IDS` mapeia cada `plan_id` deste
   app para o Price id criado no Stripe (**Product catalog**) -- um preço
   recorrente mensal por plano.

5. **Asaas**: em **Integrações → Webhooks**, cadastre a URL acima e defina
   um "Token de acesso" -- o mesmo valor vai em `ASAAS_WEBHOOK_TOKEN`
   (Asaas não assina com HMAC, autentica com esse token estático no header
   `asaas-access-token`). `ASAAS_API_KEY` vem de **Integrações → API**.

6. Redeploy com as novas variáveis e faça uma assinatura de teste (todos os
   três provedores têm um ambiente de sandbox/teste -- use-o antes de
   apontar para produção). As chamadas de `createCheckoutSession`/
   `cancelSubscription` seguem o formato documentado de cada API mas nunca
   foram exercitadas contra uma conta real nesta implementação --
   valide no sandbox de cada provedor antes de ativar em produção.

### Trocar de provedor depois

Nada fora de `src/lib/billing/` sabe qual provedor está ativo. Adicionar um
quarto provedor (ou trocar a implementação de um existente) é: escrever uma
classe que implemente `BillingProvider` (mesmo formato de
`providers/mercadopago.ts`) e registrá-la em `buildBillingProvider()`
(`src/lib/billing/index.ts`) -- o schema, a UI de planos e o endpoint de
webhook não mudam.

## Idempotência

`billing_webhook_events` tem `unique(provider, provider_event_id)`.
`applyBillingWebhookEvent()` insere ali **antes** de tocar em
`subscriptions`; se o insert falhar por violação de unicidade (evento já
processado), a função retorna sem aplicar nada de novo. Isso vale mesmo sob
retries concorrentes do provedor -- é a constraint do banco que garante a
propriedade, não um `if` na aplicação.

## Restrições (`canUseFeature`, `canAddProfessional`, `canAddService`)

Em `src/lib/plans/limits.ts`, usadas pelos server actions de criar
profissional/serviço e pelas preferências de notificação
(WhatsApp/e-mail exigem o recurso `advanced_notifications`, disponível a
partir do Pro). Cada uma:

1. Busca a assinatura da empresa.
2. Se o status não for `trialing`/`active` (sem assinatura, `past_due`,
   `incomplete`, `canceled`) -- **libera o acesso**. Billing mal
   configurado, um pagamento atrasado ou o sistema inteiro sem provedor
   real nunca bloqueiam o uso básico do produto.
3. Só quando o status é `trialing`/`active` os limites do plano (`start`:
   1 profissional/10 serviços, `pro`: 5/50, `business`: ilimitado) são
   realmente aplicados.

A lógica de decisão (passos 2-3) é pura e testada isoladamente em
`src/lib/plans/evaluate.test.ts` -- sem precisar de um banco para verificar
que "sem assinatura" libera e "no limite exato do plano" bloqueia.

## Testes

`npm run test` cobre, sem rede nem credenciais reais:

- `src/lib/plans/evaluate.test.ts` -- fail-open por status, bloqueio no
  limite exato, planos ilimitados, mensagem de upgrade correta.
- `src/lib/plans/config.test.ts` -- sanidade da configuração central.
- `src/lib/billing/crypto.test.ts` -- HMAC determinístico, comparação em tempo constante.
- `src/lib/billing/providers/{mercadopago,stripe,asaas}.test.ts` --
  verificação de assinatura aceita quando correta e rejeita corpo
  adulterado, segredo errado, cabeçalho ausente e (Stripe) timestamp fora
  da tolerância de replay.
- `src/lib/billing/apply-event.test.ts` -- idempotência (evento duplicado
  nunca toca `subscriptions`), fallback de vínculo por `business_id`
  quando `provider_subscription_id` ainda não existe, e `plan_id`
  desconhecido nunca é gravado mesmo que o provedor envie um.

## Documentação relacionada

- [`DATABASE.md`](./DATABASE.md) -- schema completo
- [`SECURITY.md`](./SECURITY.md) -- modelo de RLS
- [`NOTIFICATIONS.md`](./NOTIFICATIONS.md) -- o outro sistema que segue o
  mesmo padrão de abstração de provedor + secrets fora do banco
