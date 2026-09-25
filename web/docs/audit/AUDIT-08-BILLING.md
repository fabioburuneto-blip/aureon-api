# AUDIT-08 — Billing / Planos

Auditoria read-only. Nenhum código foi alterado. Nenhuma chamada real foi
feita contra Mercado Pago, Stripe ou Asaas (sem credenciais, sem acesso
de rede a essas APIs neste ambiente) — declarado explicitamente onde
relevante. Permissões e RLS de `subscriptions` foram confirmadas lendo o
SQL real das migrations.

## Resultado

**PASS COM RESSALVAS.** O modelo de planos tem fonte única de verdade
(preço nunca duplicado no frontend), a tabela `subscriptions` é
inacessível para escrita por qualquer cliente autenticado (só
`service_role`), o webhook verifica assinatura sobre o corpo bruto e é
idempotente por constraint de banco (não por lógica de aplicação). O
comportamento fail-open é **deliberado, documentado no próprio código e
teoricamente correto para não travar o produto** — mas, como exigido,
aqui está o levantamento completo de proteção atual vs. esperada, e ele
mostra lacunas reais para produção. **O ponto mais importante:** toda
empresa criada no produto começa (e permanece, se nada for configurado)
no provedor `local`, que nunca cobra nada de verdade — sem
`BILLING_PROVIDER` configurado em produção, o "billing" inteiro é uma
simulação sem dinheiro real envolvido.

## Planos

Fonte única: `src/lib/plans/config.ts`. Nenhum outro lugar do código
define preço, limite ou feature — confirmado por
`grep -rn "4990\|9990\|19990" src/` só encontrar essa constante em
`config.ts`; a tela `/dashboard/plano` lê `plan.priceCents` direto do
objeto importado, nunca um valor escrito de novo na UI.

| Plano | Preço/mês | Profissionais | Serviços | Features |
| --- | --- | --- | --- | --- |
| Start | R$ 49,90 | 1 | 10 | página pública, agenda, serviços, clientes |
| Pro | R$ 99,90 | 5 | 50 | + notificações avançadas (WhatsApp/e-mail) |
| Business | R$ 199,90 | ilimitado | ilimitado | + domínio próprio, múltiplas unidades ("em breve", não implementado) |

**Onde os limites são de fato checados no código** (não só declarados em
`config.ts`):

| Limite/feature | Onde é aplicado |
| --- | --- |
| `maxProfessionals` | `professionals/actions.ts` → `createProfessional` |
| `maxServices` | `services/actions.ts` → `createService` |
| `advanced_notifications` | `settings/actions.ts`, ao ligar WhatsApp/e-mail |
| `custom_domain` | **Nunca checado em nenhum lugar do código** — feature listada no plano Business mas sem nenhuma tela ou lógica que sequer ofereça configurar um domínio próprio |
| `multiple_locations` | **Nunca checado** — consistente com o próprio texto do produto marcar como "em breve" |
| `custom_public_page`/`agenda`/`services`/`customers` | Disponíveis em todos os planos, nunca gateadas (correto, são a base do produto) |

## Assinaturas (schema)

Confirmado em `supabase/migrations/20250924120008_billing.sql` +
`20250924120004_rls.sql`: `subscriptions` tem `status` (`trialing`,
`active`, `past_due`, `canceled`, `incomplete`), `plan_id` (texto restrito
por `check` a `start`/`pro`/`business`), `provider`,
`provider_customer_id`, `provider_subscription_id`,
`current_period_start`/`current_period_end`, `cancel_at_period_end`.

## Permissões — cliente autenticado não pode alterar assinatura

Testado por leitura direta das grants/policies, não presumido:

```
grant select on public.subscriptions to authenticated;
```

**Não existe `grant insert`, `grant update` nem `grant delete` para
`authenticated` em `subscriptions`, em nenhuma migration.** Só existe a
policy `subscriptions_select_owner` (leitura). Isso significa que,
mesmo que um cliente autenticado tentasse via API REST do Supabase
alterar `status`, `plan_id`, `current_period_end` ou qualquer
`provider_*_id` da própria empresa, **a operação falharia com
`permission denied`, antes mesmo de qualquer policy RLS ser avaliada** —
é uma barreira de grant, mais forte que uma policy (que poderia, em
tese, ter uma condição mal escrita). As únicas escritas em
`subscriptions` em todo o código-fonte são: (1) `applyBillingWebhookEvent`,
usando o cliente admin (`service_role`), chamado só pela rota de webhook;
(2) `LocalBillingProvider` (também `service_role`), usado pelas ações do
próprio painel (`plano/actions.ts`) quando o provedor ativo é `local`.
**Nenhum caminho de escrita nessa tabela é acionável por um usuário
comum.**

## Webhook

Lido `src/app/api/webhooks/billing/[provider]/route.ts` +
`src/lib/billing/apply-event.ts` por completo:

- **Corpo bruto:** `request.text()`, nunca `request.json()` antes de
  verificar a assinatura — importante porque reserializar o JSON
  quebraria a verificação (comentário explícito no código sobre isso).
- **Autenticação/assinatura:** verificada antes de qualquer
  processamento; provedor desconhecido ou não configurado →
  `404` (fail closed, nunca tenta adivinhar contra o adapter errado).
- **Idempotência:** real, garantida por `unique(provider,
  provider_event_id)` em `billing_webhook_events` — o código insere
  nessa tabela **antes** de tocar `subscriptions`, e trata o código de
  erro `23505` (violação de unicidade) como "evento duplicado", não como
  falha. Isso é robusto mesmo sob reentrega concorrente do mesmo evento
  pelo provedor, porque é o banco (constraint), não uma checagem
  "SELECT primeiro, INSERT depois" que teria uma corrida.
- **Duplicidade/reentrega:** coberta pelo ponto acima.
- **Estados tratados:** o `update` monta o payload dinamicamente só com
  os campos que o evento efetivamente trouxe (`...(event.status &&
  {status: event.status})`), preservando os demais campos existentes —
  correto, um evento parcial não apaga dados que ele não menciona.
- **Validação extra de `plan_id`:** revalida com `isValidPlanId()` antes
  de gravar, mesmo já havendo um `check` constraint no banco — defesa em
  profundidade citada no próprio comentário do código.

## Provedores — classificação real

| Provedor | Checkout/cancelamento | Verificação de assinatura do webhook | Testado contra a API real? | Classificação |
| --- | --- | --- | --- | --- |
| **local** | Escreve direto em `subscriptions` via `service_role`, sem nenhum pagamento real | Sempre retorna `false` (nunca aceita webhook real, por design) | N/A — não é um provedor de pagamento real | **MOCK deliberado** — é o modo "sem billing configurado", usado por padrão |
| **Stripe** | Chama `POST /v1/checkout/sessions` e `POST /v1/subscriptions/{id}` reais (`api.stripe.com`) | HMAC-SHA256 com tolerância de replay, **testado com criptografia real** (`stripe.test.ts`, sem mock de rede) | **Não** — nenhuma chamada real feita nesta auditoria nem evidência de teste anterior contra uma conta Stripe de teste | **PARCIALMENTE IMPLEMENTADO**: verificação de webhook é real e testada; checkout/cancelamento são chamadas HTTP corretas mas nunca exercitadas (nem por teste automatizado, nem contra a API real) |
| **Mercado Pago** | Chama `POST /preapproval` e `PUT /preapproval/{id}` reais (`api.mercadopago.com`) | Assinatura `x-signature`/`x-request-id`, mesma estrutura de teste que Stripe | Não | **PARCIALMENTE IMPLEMENTADO**, mesmo padrão do Stripe |
| **Asaas** | Chama `POST /customers` e `POST /subscriptions` reais (`api.asaas.com`) | Token estático (`asaas-access-token`) comparado com `timingSafeEqual` | Não | **PARCIALMENTE IMPLEMENTADO**, mesmo padrão |

Nenhum dos três provedores reais é "só um adapter vazio" — todos têm
lógica de negócio completa (montagem de request, mapeamento de status,
tratamento de erro HTTP) — mas nenhum foi testado fim-a-fim contra a
API real do respectivo provedor, nem nesta auditoria nem em nenhuma
evidência anterior encontrada no repositório.

## FAIL-OPEN — comportamento obrigatório verificado

Confirmado lendo `src/lib/plans/evaluate.ts`:
`ENFORCED_STATUSES = {'trialing', 'active'}` — **todo o resto libera
acesso total, sem nenhuma restrição de limite ou feature.** Isso é
deliberado (comentário explícito: "billing being unconfigured, mid-setup,
or having a hiccup must never lock an owner out of their own dashboard")
e faz sentido para não travar um MVP — mas para produção, com dinheiro
real envolvido, precisa ser uma decisão consciente, não um acaso de
implementação. Tabela obrigatória:

| STATUS | ACESSO ATUAL | ACESSO ESPERADO PARA PRODUÇÃO | DIFERENÇA |
| --- | --- | --- | --- |
| Sem assinatura (nenhuma linha em `subscriptions`) | Total (fail-open — plano padrão `start`, sem limite aplicado) | Deveria ser impossível de acontecer em produção (toda empresa nasce com uma linha `local`/`trialing` via `create_business()`), mas se acontecer por bug/migração, hoje dá acesso irrestrito | Nenhuma trava de segurança para o caso "isso nunca deveria acontecer" |
| `trialing` | Limites do plano aplicados normalmente | Igual | Nenhuma |
| `active` | Limites do plano aplicados normalmente | Igual | Nenhuma |
| `past_due` (pagamento atrasado/falhou) | **Total, sem nenhuma restrição** (fail-open) | Normalmente um produto SaaS restringe ou avisa fortemente nesse estado (ex.: banner de cobrança pendente, ou limitar após um período de tolerância) | O produto atual não diferencia "atrasado há 1 dia" de "cancelado há 1 ano" — mesmo acesso total dos dois |
| `canceled` | **Total, sem nenhuma restrição** (fail-open) | Uma assinatura cancelada deveria, na maioria dos modelos de negócio, voltar ao plano gratuito/limitado (ou nenhum acesso, dependendo do modelo) depois do fim do período pago | Uma empresa pode cancelar a assinatura e continuar com profissionais/serviços ilimitados indefinidamente — **risco financeiro direto** |
| `incomplete` (checkout iniciado, pagamento não confirmado) | **Total, sem nenhuma restrição** (fail-open) | Normalmente deveria ter acesso limitado até a primeira cobrança confirmar | Alguém pode iniciar um checkout que nunca completa e ficar com acesso total permanentemente |

**Nenhuma dessas diferenças é um bug de código** — é exatamente o que o
comentário do código diz que faz de propósito. O achado da auditoria é
que essa é uma escolha de produto com risco financeiro real se for
mantida sem revisão consciente antes de cobrar de verdade.

## Riscos financeiros

1. **Provedor padrão `local` nunca cobra nada.** Sem
   `BILLING_PROVIDER` configurado em produção, qualquer empresa pode
   "assinar" o plano Business (R$ 199,90) pelo botão do painel sem
   nenhum pagamento real acontecer — `LocalBillingProvider.createCheckoutSession`
   só escreve `status = 'active'` direto no banco.
2. **`past_due`/`canceled`/`incomplete` não perdem acesso** (tabela
   acima) — mesmo com um provedor real configurado e um pagamento que
   de fato falhou, o produto continua liberando tudo.
3. Nenhum dos três provedores reais foi testado contra uma cobrança de
   verdade nesta ou em auditorias anteriores — o primeiro teste real só
   aconteceria em produção, com dinheiro de cliente real.

## Riscos de fraude

- Como `subscriptions` não é gravável por `authenticated`, não há uma
  forma direta de um cliente forjar o próprio status via API REST — esse
  vetor está fechado.
- O vetor de fraude real é o item 1 acima (modo `local` sempre ativo por
  padrão) — não é uma falha de autorização, é a ausência de qualquer
  cobrança real até alguém configurar deliberadamente um provedor.

## Riscos de webhook

- Nenhuma falha de assinatura/idempotência encontrada — ambas
  implementadas corretamente e testadas (assinatura) ou garantidas por
  constraint (idempotência).
- Risco residual: se `BILLING_PROVIDER` for trocado de provedor (ex.:
  de `stripe` para `mercadopago`) sem migrar as assinaturas existentes,
  eventos antigos do provedor anterior parariam de ter efeito
  (`getBillingProviderByName` só aceita o provedor atualmente ativo) —
  comportamento correto de segurança, mas precisa de um plano de
  migração manual, não coberto por nenhum código.

## Gaps de produção

1. Nenhum provedor real testado contra uma cobrança de verdade.
2. `custom_domain`/`multiple_locations` são features vendidas no plano
   Business mas sem nenhuma implementação (nem checagem, nem tela).
3. Fail-open cobre 4 de 6 estados possíveis (todos exceto
   `trialing`/`active`) — ver tabela.
4. Nenhum aviso na UI para o empresário quando a assinatura está
   `past_due`/`canceled`/`incomplete` — a tela `/dashboard/plano` foi
   parcialmente revisada em `AUDIT-06`; não há banner de alerta de
   cobrança fora dessa página.

## Testes executados

1. Leitura completa de `config.ts`, `evaluate.ts`, `limits.ts`,
   `apply-event.ts`, `route.ts` (webhook), `local.ts`, `stripe.ts`,
   `mercadopago.ts`, `asaas.ts`, `crypto.ts`.
2. Grep de preço (`4990`/`9990`/`19990`) em todo `src/` → só em
   `config.ts`.
3. Grep de grants/policies de `subscriptions` em todas as migrations →
   confirmado só `select` para `authenticated`.
4. Grep de `canUseFeature`/`canAddProfessional`/`canAddService` em todo
   `src/` → confirmado onde cada gate é (ou não é) aplicado.
5. Leitura dos testes de `stripe.test.ts` → confirmado que cobre
   assinatura/mapeamento de status com criptografia real, não a chamada
   HTTP de checkout.

## Recomendações

1. Antes de cobrar de clientes reais, decidir explicitamente (não por
   omissão) o que cada estado de `past_due`/`canceled`/`incomplete`
   deveria liberar, e ajustar `ENFORCED_STATUSES` de acordo — hoje só
   `trialing`/`active` restringem algo.
2. Adicionar um aviso visível no painel quando a assinatura não está em
   dia (`past_due`) ou foi cancelada, mesmo que o acesso continue
   liberado por decisão de produto.
3. Testar pelo menos um provedor real (ambiente de sandbox/teste do
   próprio Stripe/Mercado Pago/Asaas) de ponta a ponta — checkout,
   webhook de confirmação, cancelamento — antes de ativar em produção.
4. Decidir se `custom_domain`/`multiple_locations` continuam sendo
   vendidos no plano Business sem existir, ou remover da lista de
   features até serem implementados.
5. Garantir, via processo de deploy (não só documentação), que
   `BILLING_PROVIDER` está de fato configurado em produção antes de
   aceitar qualquer assinatura paga — hoje nada impede subir para
   produção esquecendo essa variável e rodar indefinidamente no modo
   `local`.
