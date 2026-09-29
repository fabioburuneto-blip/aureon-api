# ETAPA 4 — RELATÓRIO FINAL

Implementação, não auditoria. Base: `docs/audit/ETAPA-4-NOTIFICATIONS-AUDIT.md`
(commit `3078674`). Implementa **somente** os dois achados dessa auditoria
que exigiam correção — nada além disso.

## 1. Objetivo

Fechar, com autoridade no banco de dados (não só na aplicação), os dois
achados da auditoria:

1. **Achado 1 (MÉDIA)** — `advanced_notifications` só era verificado em
   `settings/actions.ts` (Server Action); uma chamada direta à REST API do
   Supabase podia ligar WhatsApp/e-mail sem plano elegível.
2. **Achado 2 (BAIXA/MÉDIA)** — nada revalidava o plano depois que um
   canal já estava ligado; um downgrade não desligava nada, e o worker
   nunca checava o plano antes de enviar.

Os outros pontos "operacionais" que a auditoria já havia documentado
(WhatsApp/e-mail nunca testados com credenciais reais; scheduler
`pg_cron` é passo manual) não são bugs — são limitações de ambiente/
configuração, tratadas aqui só com documentação de produção
(`docs/PRODUCTION-NOTIFICATIONS.md`), nunca com código simulando uma
validação que não pôde acontecer de verdade.

## 2. Arquitetura preservada

Nenhuma fila nova, nenhum sistema de notificação paralelo, nenhum
provider duplicado, nenhum trigger novo em `appointments`, nenhum lembrete
duplicado. O pipeline `appointment write → trg_appointments_notify →
notifications/notification_deliveries → process-notifications →
WhatsApp/Resend` continua sendo a única via, exatamente como antes.
`appointment-reminders` não foi tocado. O único trigger novo
(`trg_business_settings_notification_gate`) vive em `business_settings`,
uma tabela diferente, e só reage à transição `false → true` de
`whatsapp_enabled`/`notify_email_enabled` — não interfere em nenhum outro
fluxo.

Confirmado por `git diff --stat` antes de começar: árvore limpa, branch
`claude/blissful-edison-4wt18p`, HEAD em `3078674` (a auditoria).

## 3. Alterações realizadas

| Arquivo | Tipo | O quê |
| --- | --- | --- |
| `supabase/migrations/20250924120015_notifications_plan_gate.sql` | novo | `is_advanced_notifications_allowed(uuid)` + trigger `trg_business_settings_notification_gate` |
| `supabase/functions/_shared/notifications/plan-gate.ts` | novo | `createEligibilityChecker()` (cache por `business_id` para 1 lote) + constante `PLAN_INELIGIBLE_ERROR` |
| `supabase/functions/_shared/notifications/plan-gate.test.ts` | novo | 6 testes unitários do cache/dedup |
| `supabase/functions/process-notifications/index.ts` | modificado | revalidação de plano antes de chamar o provider; select agora inclui `business_id` |
| `supabase/tests/db.sql` | modificado | fixture reordenada (upgrade/downgrade temporário de A) + nova seção "ETAPA 4" com 13 asserções |
| `docs/NOTIFICATIONS.md` | modificado | nova seção "Plan gate" + nota sobre `plan_ineligible` no status `failed` |
| `docs/PRODUCTION-NOTIFICATIONS.md` | novo | checklist de configuração de produção completo |
| `docs/audit/ETAPA-4-REPORT.md` | novo | este arquivo |

Nenhum outro arquivo foi tocado. Nenhuma UI foi alterada.

## 4. Feature gating

Duas camadas independentes agora, mirando a mesma fonte de verdade
(`src/lib/plans/evaluate.ts`):

1. **Server Action** (já existia, inalterada): `updateNotificationSettings()`.
2. **Banco** (novo): `trg_business_settings_notification_gate`, dispara só
   na transição `false → true` de `whatsapp_enabled`/`notify_email_enabled`,
   chama `is_advanced_notifications_allowed(business_id)`, e rejeita com
   `raise exception ... errcode 42501` se não elegível.

**Por que só na transição, não em todo update**: se disparasse em
qualquer `UPDATE`, um negócio que já tinha WhatsApp ligado e depois sofreu
downgrade ficaria **impedido de salvar qualquer outra configuração**
(ex.: desligar um lembrete) por causa de um valor `true` que já vinha de
antes — um efeito colateral pior que o problema original. Testado
explicitamente (última asserção da seção 12 abaixo).

**Bypass via REST direta**: fechado. Testado ao vivo — ver seção 15.

## 5. Billing states

Tabela pedida pela Fase 2, com o comportamento real (não inventado —
espelha `isLimitEnforced()`/`ENFORCED_STATUSES` de
`src/lib/plans/evaluate.ts`, que já existia antes desta etapa):

| Status | `advanced_notifications` é enforced? | Resultado prático |
| --- | --- | --- |
| `trialing` | Sim | Precisa `plan_id in (pro, business)` |
| `active` | Sim | Precisa `plan_id in (pro, business)` |
| `past_due` | Não (fail-open) | Permitido, qualquer plano |
| `canceled` | Não (fail-open) | Permitido, qualquer plano |
| `incomplete` | Não (fail-open) | Permitido, qualquer plano |
| nenhuma assinatura (linha ausente) | Não (fail-open) | Permitido |
| `business_id` desconhecido/inexistente | Não (fail-safe) | Permitido, nunca erro |

**Decisão confirmada com o usuário antes de implementar** (ver
transcrição desta sessão): manter o fail-open para `past_due`/`canceled`/
`incomplete`, replicando o comportamento já existente e documentado em
`evaluate.ts`, em vez de inventar uma política de billing mais restritiva
não pedida pela auditoria. `is_advanced_notifications_allowed()` implementa
exatamente esta tabela — nenhuma suposição própria.

## 6. WhatsApp

Não alterado nesta etapa além da revalidação de plano no worker (seção
7). Continua exatamente como a auditoria classificou:
**(A)** implementado, **(B)** não mockado, **(C)** preparado,
**(D)/(E)** nunca comprovado com credenciais reais — este ambiente não tem
acesso de saída à Graph API da Meta nem credenciais reais. **IMPLEMENTADO,
MAS NÃO VALIDADO COM CREDENCIAIS REAIS.**

## 7. E-mail

Mesma situação do WhatsApp — Resend não alterado, mesma classificação,
mesma limitação de ambiente. **IMPLEMENTADO, MAS NÃO VALIDADO COM
CREDENCIAIS REAIS.**

## 8. Notificações internas

Não alteradas. A auditoria já havia confirmado que o painel in-app é
genuinamente conectado ao banco (não é estrutura visual). Nenhum teste
novo foi necessário aqui — os já existentes (RLS de `notifications`,
seção "NOTIFICATIONS" de `db.sql`) continuam passando sem modificação de
comportamento.

## 9. Lembretes

`appointment-reminders` não foi tocado. A revalidação de plano acontece em
`process-notifications`, que é quem efetivamente envia — cobre tanto
deliveries criadas pelo trigger de evento quanto as criadas pelo worker de
lembretes, sem precisar duplicar a checagem nos dois lugares (única fila,
único ponto de saída).

## 10. Scheduler

Não alterado. Continua sendo um passo manual (`pg_cron`/`pg_net` via SQL
Editor) — não automatizado por nenhuma migration, por desenho (é
configuração de infraestrutura do projeto Supabase, não schema da
aplicação). Passo-a-passo completo em `docs/PRODUCTION-NOTIFICATIONS.md`,
seção 6. **Não fingido como validado**: nunca foi executado contra um
scheduler real neste ambiente.

## 11. Idempotência

Preservada e não alterada — nenhuma constraint removida, nenhum mecanismo
de dedup tocado. O novo gate de plano não introduz nenhum novo risco de
duplicação: `is_advanced_notifications_allowed()` é uma função `stable`,
somente leitura, sem efeito colateral; `createEligibilityChecker()` só
adiciona um cache de leitura por `business_id` dentro do mesmo lote (não
cria nem grava nada). A marcação de uma entrega como `failed` por
`plan_ineligible` é uma escrita terminal única, sem risco de duplicar
(mesmo padrão de qualquer outra atualização de status já existente).

## 12. Retry

Preservado. `plan_ineligible` é tratado como **terminal, não retryable**
(vai direto para `failed`, nunca `retrying`) — decisão explícita e
documentada no código e em `docs/NOTIFICATIONS.md`: não é uma falha
transitória de rede/provider, é a ausência do direito ao recurso; deixar
retentar indefinidamente só gastaria um slot do lote a cada execução até
alguém fazer upgrade, sem nenhuma chance de sucesso sozinho. Reutiliza o
status `failed` já existente — nenhum status novo foi criado.

## 13. Segurança

- O bypass via REST direta (Achado 1) está fechado no banco, não só na
  aplicação — testado ao vivo (seção 15).
- Nenhum novo grant foi concedido a `anon`/`authenticated`.
  `is_advanced_notifications_allowed()` é `security definer`, `grant
  execute` só para `authenticated`/`service_role` — não expõe nenhum dado
  além do booleano de elegibilidade (que não é sensível: não revela plano,
  não revela status de billing, só "pode ou não pode").
- Nenhum secret foi introduzido, movido, logado ou exposto neste diff.
- `last_error = 'plan_ineligible'` é uma string fixa do código da
  aplicação, não um dado do usuário — não há risco de vazamento por essa
  via.

## 14. Multi-tenancy

Não alterado, e não havia gap aqui — a auditoria já havia confirmado
isolamento completo de `notifications`/`notification_deliveries`. O novo
trigger em `business_settings` opera sempre sobre `new.business_id` (a
própria linha sendo escrita), nunca cruza tenants. Reconfirmado
explicitamente: as asserções da seção 12 do `db.sql` novo usam
exclusivamente o negócio B, sem qualquer interação com o negócio A.

## 15. Testes

**Unitários (Vitest, Node)** — `npm test`: **207/207 passando** (201
existentes + 6 novos em `plan-gate.test.ts`, cobrindo cache/dedup/
concorrência in-memory de `createEligibilityChecker`).

**SQL, ao vivo, Postgres 16 descartável, nunca produção**:

1. **Prova de que o teste detecta a ausência da proteção** (Fase 14,
   exigida explicitamente): stub + as 14 migrations *anteriores* a esta
   etapa aplicadas, `db.sql` (já com a nova seção) executado —
   **falhou exatamente na asserção esperada**
   (`ASSERTION FAILED: a business on an ineligible plan (start/trialing)
   must be blocked from enabling WhatsApp even via a direct table
   update...`), confirmando que sem `20250924120015` o bypass realmente
   funciona e o teste realmente o pega.
2. Banco descartável **novo**, as 15 migrations aplicadas do zero
   (incluindo a nova), `db.sql` completo executado —
   **`ALL ASSERTIONS PASSED`**, exit code 0, zero ocorrências de
   `ASSERTION FAILED` no log completo.
3. Confirmado dentro do mesmo run que as seções "CLIENT BOOKING PORTAL
   (Etapa 3)" — token, cancelamento, reagendamento, dedup de cliente —
   continuam passando sem nenhuma alteração de comportamento.

As novas 13 asserções da seção "ETAPA 4" cobrem, usando o negócio B (nunca
tocado antes deste ponto do arquivo, no plano trial/start padrão):

- estado inicial sanity-check (trial/start, canais desligados);
- bypass via `UPDATE business_settings` direto como dono autenticado, em
  plano inelegível, para WhatsApp → bloqueado;
- mesmo bypass para e-mail → bloqueado;
- upgrade real para pro/active → o mesmo update agora funciona;
- `past_due` → fail-open (permitido), confirmando a política existente;
- `canceled` → fail-open;
- `incomplete` → fail-open;
- `business_id` inexistente → fail-safe (`true`, nunca erro);
- downgrade de plan_id com status ainda `active` → canal que já estava
  ligado **não** se desliga sozinho (nenhum código faz isso hoje) **mas**
  `is_advanced_notifications_allowed()` já reflete `false` para essa
  entrega, provando que o Achado 2 está fechado no ponto que importa (o
  que o worker verifica antes de enviar);
- update de um campo não relacionado (`notify_reminder_24h`) com um canal
  já ligado e plano agora inelegível → **não bloqueado** (prova de que o
  trigger só age na transição off→on, não em qualquer update).

## 16. SQL assertions

Arquivo completo: `supabase/tests/db.sql`. Nova seção começa em
`\echo 'ETAPA 4 -- advanced_notifications plan gate...'`. Reprodução:

```bash
createdb aureon_test
psql aureon_test -f supabase/tests/fixtures/local-stub.sql
for f in supabase/migrations/*.sql; do psql aureon_test -f "$f"; done
psql aureon_test -f supabase/tests/db.sql
```

## 17. QA visual

**Não aplicável** — esta etapa não alterou nenhum componente de UI
(`git diff --stat` confirma: só migration, Edge Function, testes e docs).
Nenhum QA de viewport foi necessário.

## 18. Production readiness

Checklist completo, novo, em `docs/PRODUCTION-NOTIFICATIONS.md`: o que já
funciona só com as migrations, deploy das Edge Functions, todos os
secrets necessários, configuração do WhatsApp Cloud API e do Resend
passo-a-passo, os dois `cron.schedule`, como validar cada camada (em
ordem, do que não depende de nada externo até o teste de entrega real), e
como monitorar/diagnosticar falhas em produção pelos valores de
`last_error`. Nenhum valor real de secret aparece no arquivo.

## 19. Limitações

- **WhatsApp e e-mail continuam nunca testados com credenciais/API reais**
  — este ambiente não tem as credenciais nem acesso de saída à Graph API
  da Meta ou à API do Resend. **IMPLEMENTADO, MAS NÃO VALIDADO COM
  CREDENCIAIS REAIS.**
- **Scheduler (`pg_cron`) continua sendo um passo manual**, não
  automatizado por nenhuma migration — nunca executado contra um projeto
  Supabase real neste ambiente. **IMPLEMENTADO (documentado), MAS NÃO
  VALIDADO CONTRA UM SCHEDULER REAL.**
- **Um canal já ligado não se desliga sozinho num downgrade** — isso é
  intencional (ver seção 4: evitar bloquear updates não relacionados) e a
  entrega correspondente já para de ser enviada de fato (seção 15, item
  "downgrade"), mas o toggle na tela de configurações continua mostrando
  `true` até o próprio dono desligar manualmente ou o Server Action ser
  chamado de novo. Isso não é uma falha de segurança (nenhuma mensagem sai
  de fato), é uma limitação de UX que a auditoria não pediu para corrigir
  e que estava fora do escopo desta etapa ("implementar somente o que a
  auditoria identificou como necessário").
- **Achado 3 da auditoria (sem webhook de status de entrega do WhatsApp)**
  não foi corrigido — a auditoria classificou como limitação de produto
  (severidade BAIXA), não como algo que a Etapa 4 pediu para fechar.
- Dependência de credenciais da Vercel: nenhuma — notificações não usam
  nenhuma env var do projeto Vercel/Next.js, só Edge Function secrets.

## 20. Configuração manual necessária

Ver `docs/PRODUCTION-NOTIFICATIONS.md` para o checklist completo. Resumo:

1. `supabase functions deploy process-notifications appointment-reminders`
2. `supabase secrets set CRON_SECRET=... WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=... RESEND_API_KEY=... EMAIL_FROM_ADDRESS=...`
3. Criar app WhatsApp Business na Meta for Developers, validar número.
4. Verificar domínio no Resend.
5. `create extension pg_cron; create extension pg_net;` + dois
   `cron.schedule(...)` no SQL Editor do projeto.

Nenhum desses 5 passos é aplicado por uma migration ou por este commit —
são ações de infraestrutura, uma vez por projeto.

---

## Quality gate final

```
npm run lint       -> limpo, zero erros/warnings
npm run typecheck  -> limpo, zero erros
npm test            -> 207/207 passando (25 arquivos)
npm run build        -> build de produção completo, todas as rotas geradas
```

SQL: descrito na seção 15/16 acima — banco descartável, do zero, 15
migrations, `ALL ASSERTIONS PASSED`.

Etapa 3: reconfirmada intacta dentro do mesmo run de `db.sql` (seção 15,
item 3).
