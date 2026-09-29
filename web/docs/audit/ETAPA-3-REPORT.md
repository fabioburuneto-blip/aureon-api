# ETAPA 3 — Motor completo de agendamento do cliente final

## ESTADO ANTERIOR

Lido antes de qualquer alteração: `AUDIT-05-BOOKING-ENGINE.md`,
`AUDIT-09-SECURITY.md`, `P0-FIX-REPORT.md`, `ETAPA-2-REPORT.md`, o schema
atual e `create_public_appointment()`/`get_available_slots()`/
`reschedule_appointment()`/`validate_appointment_slot()` reais.

As duas auditorias de leitura (`AUDIT-05`, `AUDIT-09`) descrevem um estado
**anterior à P0**: relatam que `create_public_appointment()` não validava
`business_hours`/`is_closed` e que o reagendamento do painel não
revalidava nada além da constraint de exclusão. **Isso já não é verdade**
— confirmado lendo `P0-FIX-REPORT.md` e o código real de
`20250924120011_centralize_appointment_validation.sql`: `validate_appointment_slot()`
já é a fonte única de verdade para horário/bloqueio/conflito, usada por
`create_public_appointment()` e por `reschedule_appointment()` (painel).
O que essas auditorias confirmam e que **continuava** verdadeiro no
início desta etapa: **não existia nenhum caminho para o cliente consultar,
cancelar ou reagendar o próprio agendamento** — essa é a lacuna real que
a Etapa 3 fecha.

## FLUXO IMPLEMENTADO

`/{slug}` → seção Agendamento (já existente, Etapa 2) → assistente de 6
passos (`Serviço → Profissional → Data → Horário → Seus dados → Revisão`)
→ Confirmar → Sucesso (com link `/agendamento/{token}`) → consulta →
cancelar **ou** reagendar. Tudo sem login em nenhum momento — confirmado
por ausência total de qualquer chamada `supabase.auth` em todo o fluxo.

✅ **IMPLEMENTADO E VALIDADO** — fluxo completo clicado de ponta a ponta
num navegador real (Chromium via Playwright), incluindo o passo de
consulta/cancelamento e um segundo agendamento separado levado até o
reagendamento (ver "QA REAL").

## BOOKING

**Nenhuma lógica de disponibilidade foi recriada.** O assistente
(`src/app/[slug]/booking-widget.tsx`, reescrito como wizard mobile-first,
mesmas props/RPCs de antes) continua chamando `get_available_slots()` e
`create_public_appointment()` exatamente como já chamava — só a UI ao
redor mudou (de um formulário empilhado único para 6 passos com "Passo X
de 6" sempre visível, satisfazendo "o cliente deve sempre saber o que
está escolhendo agora").

- **Serviço**: lista só os serviços ativos já filtrados no servidor
  (`getBusinessPageData()`, inalterado). Nome, descrição, preço, duração
  — nenhum dado administrativo.
- **Profissional**: lista os profissionais ativos da empresa; a
  combinação profissional-serviço é revalidada no servidor por
  `validate_appointment_slot()` (`professional does not offer this
  service`) — nunca confiada só à UI.
- **Data**: tiras de chips dos próximos 30 dias (não uma lista infinita),
  cálculo do calendário é só apresentação — a autoridade real continua
  sendo `get_available_slots()`/`validate_appointment_slot()` no servidor.
- **Horário**: grade de botões vinda 100% de `get_available_slots()`,
  inalterado.
- **Corrida entre a exibição e a confirmação**: se um horário exibido
  como livre for reservado por outra pessoa entre a exibição e o clique
  em "Confirmar", `create_public_appointment()` (constraint `EXCLUDE`,
  P0) rejeita com `23P01` e a UI mostra "Esse horário acabou de ser
  reservado. Escolha outro." — mesmo comportamento de antes, agora também
  reaproveitado no reagendamento pelo cliente.

✅ **IMPLEMENTADO E VALIDADO** — reaproveita o motor P0 sem alteração;
verificado ao vivo (ver "CONCORRÊNCIA" e "TESTES").

## CLIENTE

Nome, WhatsApp, e-mail opcional — mesmo formulário/validação de antes
(`publicBookingSchema`), sem campo novo coletado. Dedup por telefone
dentro do `business_id` é a mesma lógica de `create_public_appointment()`
(inalterada) — **reconfirmado com uma asserção SQL permanente nova**
(não existia uma antes desta etapa): mesmo telefone, duas reservas na
mesma empresa reaproveitam o mesmo `customer_id`; o mesmo telefone usado
numa empresa diferente cria um `customer_id` diferente (nunca busca
global por telefone).

✅ **IMPLEMENTADO E VALIDADO**.

## TOKEN

`appointments.client_token` (migration `20250924120014`): 64 caracteres
hex (256 bits), construído a partir de dois `gen_random_uuid()`
independentes concatenados — não deriva do `id` da linha, não é
sequencial, não usa a extensão `pgcrypto` (evitada de propósito;
`gen_random_uuid()` já é core do Postgres 13+, a mesma primitiva que todo
o resto do schema já usa para chave primária). `unique`, indexado.

- Nunca é o `id` interno do agendamento.
- Nunca é exposto por nenhum `SELECT` público em `appointments` — só é
  lido de dentro das três funções `SECURITY DEFINER` novas.
- Token de uma empresa jamais afeta outra: testado ao vivo (empresa A
  cancela com o próprio token → agendamento de B permanece `pending`,
  reconfirmado por asserção SQL permanente).

✅ **IMPLEMENTADO E VALIDADO**.

## CONSULTA

`/agendamento/[token]` (`src/app/agendamento/[token]/page.tsx`), sempre
`robots: noindex` (nunca indexável — é uma página por-cliente, não
conteúdo de vitrine). Mostra apenas: empresa, serviço, profissional,
data/horário, status, endereço/WhatsApp quando existirem. **Nunca**
mostra IDs internos, dados administrativos ou de outro cliente — o DTO
retornado por `get_public_appointment()` é uma projeção explícita
(`business_name`, `service_name`, ... nunca `business.id`/
`appointment.id`/`customer_id`). Token inexistente, malformado, vazio ou
alterado em 1 caractere → **a mesma mensagem genérica** em todos os
casos ("Este link de agendamento não é válido ou expirou."), tanto no
banco (`get_public_appointment()` sempre levanta `appointment not found`)
quanto na UI (`mapPublicAppointmentError`).

✅ **IMPLEMENTADO E VALIDADO** — testado ao vivo com token real, token
alterado, token vazio e token nulo (todos → mesmo erro); página real
carregada num navegador.

## CANCELAMENTO

`cancel_public_appointment(token)`, `SECURITY DEFINER`. Regra central:
`business_settings.client_cancellation_min_hours` (nova coluna, default
24h) — **nunca hardcoded**; lida a partir dessa única coluna em
`get_public_appointment()` (calcula `can_cancel`) e em
`cancel_public_appointment()` (reconfirma antes de escrever, nunca
confia no `can_cancel` que o cliente viu por último). Só
`pending`/`confirmed` podem ser cancelados; `cancelled`/`completed`/
`no_show` são rejeitados com uma mensagem própria. Cancelamento é sempre
`UPDATE status = 'cancelled'` — nunca `DELETE` (histórico preservado); o
horário é liberado automaticamente porque a constraint `EXCLUDE` de
`appointments` já ignora linhas `status = 'cancelled'` (mecanismo da P0,
reaproveitado sem alteração).

✅ **IMPLEMENTADO E VALIDADO** — testado ao vivo: fora da janela (sucesso),
dentro da janela (bloqueado), já cancelado (bloqueado), `completed`
(bloqueado) — os quatro casos também como asserção SQL permanente.

## REAGENDAMENTO

`reschedule_public_appointment(token, novo_horário)`. Empresa, serviço e
profissional são **lidos da própria linha do agendamento, nunca aceitos
como parâmetro** — o cliente só pode mudar data/horário, exatamente como
pedido. Delegado inteiramente a `validate_appointment_slot()` (a mesma
função P0 que `create_public_appointment()` e o `reschedule_appointment()`
do painel já usam) — nenhuma segunda lógica de disponibilidade. Reaplica
também `min_notice_minutes`/`booking_window_days` (as mesmas regras de
uma reserva nova) e a mesma janela de `client_cancellation_min_hours` do
cancelamento — decisão deliberada: sem isso, reagendar seria uma forma
trivial de contornar o prazo de cancelamento.

✅ **IMPLEMENTADO E VALIDADO** — testado ao vivo: reagendar para dentro
de um `blocked_times` ativo (bloqueado, com a mesma mensagem que uma
reserva nova receberia), reagendar para um horário livre (sucesso, `starts_at`
persistido), reagendar um `completed` (bloqueado) — todos também como
asserção SQL permanente. Fluxo completo também clicado num navegador
real (ver "QA REAL"), com o novo `starts_at` conferido diretamente no
banco (não só na tela).

## STATUS

`pending`/`confirmed` → cliente pode cancelar e reagendar (sujeito à
janela de antecedência). `cancelled`/`completed`/`no_show` → nenhuma das
duas ações é permitida, em nenhuma circunstância — reforçado tanto em
`get_public_appointment()` (`can_cancel`/`can_reschedule` calculados) 
quanto de novo, independentemente, dentro de `cancel_public_appointment()`/
`reschedule_public_appointment()` (nunca confiam no valor que o cliente
viu por último).

✅ **IMPLEMENTADO E VALIDADO**.

## SEGURANÇA

- **RLS/P0 preservados**: nenhuma policy, grant de coluna de `businesses`,
  ou a lógica de `validate_appointment_slot()`/`create_public_appointment()`/
  `reschedule_appointment()` (painel) foi tocada. Confirmado relendo os
  arquivos antes de escrever a migration e reconfirmado pela suíte SQL
  completa (pré-existente + P0 + Etapa 1 + Etapa 2) continuando
  `ALL ASSERTIONS PASSED` depois desta etapa.
- **Cross-tenant via token**: testado ao vivo — token da empresa A nunca
  afeta a empresa B (cancelamento, leitura), e vice-versa. Não existe
  parâmetro "business_id"/"tenant" em nenhuma das três novas funções — o
  token sozinho resolve a linha, então não há como um chamador "passar a
  empresa errada".
- **Enumeração**: 256 bits de entropia tornam adivinhar um token
  inviável por força bruta; documentado como a defesa real (não o rate
  limit, que é só uma camada extra).
- **Erros nunca vazam detalhes internos**: `mapPublicAppointmentError()`
  (`src/app/agendamento/[token]/errors.ts`) é a única fonte de mensagem
  mostrada ao cliente — 8 casos testados unitariamente, incluindo que uma
  mensagem de erro desconhecida (ex.: erro de SQL bruto) nunca vaza no
  texto exibido.
- **`agendamento` como slug reservado**: adicionado a
  `is_slug_reserved()` — sem isso, uma empresa poderia registrar o slug
  `agendamento` e colidir com a rota `/agendamento/[token]`. Testado ao
  vivo e como asserção SQL permanente.
- **`/agendamento/[token]` nunca indexável** (`robots: {index:false}`,
  também listado em `disallow` no `robots.ts`).

✅ **IMPLEMENTADO E VALIDADO**.

## CONCORRÊNCIA

Reexecutado com dois processos `psql` genuinamente paralelos (`&` + `wait`
no shell, não sequenciais) contra o mesmo negócio/serviço/profissional/
horário, depois da migration desta etapa aplicada (para confirmar que a
nova coluna `client_token` não alterou o comportamento da constraint
`EXCLUDE`):

```
Processo 1: create_public_appointment(...) → sucesso (1 linha)
Processo 2: create_public_appointment(...) → ERROR: slot is no longer available (23P01)
```

Exatamente 1 sucesso, 1 rejeição amigável — igual ao comportamento
documentado na P0, agora reconfirmado com o schema desta etapa.

✅ **IMPLEMENTADO E VALIDADO**.

## UX MOBILE

Assistente e página de consulta/reagendamento testados num navegador
real (Chromium) em 375px, 390px e 768px — **sem scroll horizontal em
nenhum dos três** (`document.documentElement.scrollWidth >
clientWidth` → `false` nos três, tanto na página pública quanto em
`/agendamento/[token]`). Botões full-width, chips de data em fita
horizontal rolável (não aperta o layout), grade de horários 3 colunas,
contador "Passo X de 6" sempre visível para orientação. Fluxo de
reagendamento (data → horário → confirmar) verificado visualmente em
375px.

✅ **IMPLEMENTADO E VALIDADO** — screenshots reais capturados e
inspecionados (não presumido a partir do CSS).

## TESTES

**SQL, permanentes** (`supabase/tests/db.sql`, nova seção "CLIENT
BOOKING PORTAL"), 17 novas asserções: token de 64 chars/único, token
inválido/vazio/nulo/alterado → erro genérico, cross-tenant (token de A
nunca cancela/afeta B), cancelamento permitido fora da janela, bloqueado
dentro da janela, bloqueado em já-cancelado, bloqueado em `completed`
(cancelar e reagendar), reagendamento bloqueado por `blocked_times`
(reaproveitando `validate_appointment_slot()`), reagendamento bem-sucedido
para horário livre, dedup de cliente mesmo telefone/mesma empresa vs.
mesmo telefone/empresa diferente, `agendamento` como slug reservado.
Confirmado **falhando** contra uma cópia do banco com as migrations até
a Etapa 2 (erro `column "client_token" does not exist` na primeira
asserção nova) e **passando** integralmente com esta migration aplicada
— mesma dupla verificação usada desde a P0.

**Correção pós-validação (achado real, não hipotético):** numa nova
rodada de verificação da suíte completa contra um Postgres descartável
recém-criado, o fixture do agendamento de teste de Salão B usava
`now() + interval '1 hour'` como horário de criação — um valor não
determinístico, que depende do horário real em que a suíte é executada
e pode cair fora do expediente (09:00-18:00) da empresa, causando uma
falha intermitente (`outside business hours`) sem relação nenhuma com
nenhuma proteção P0/Etapa 3. Corrigido: o agendamento de teste agora é
criado num horário fixo e válido (`2026-10-16 15:00:00-03`) dentro do
expediente, e só depois tem `starts_at` movido para `now() + 1h` via um
`UPDATE` direto (contornando de propósito `validate_appointment_slot()`
só nesta montagem de estado de teste, não na função testada) — a suíte
completa foi reexecutada do zero duas vezes após a correção, ambas com
`ALL ASSERTIONS PASSED`.

**TypeScript, permanentes** (Vitest): `errors.test.ts` (8 casos —
mapeamento de cada mensagem de erro do Postgres para uma mensagem
amigável, incluindo que uma mensagem desconhecida nunca vaza),
`rate-limit.test.ts` (4 casos — limite respeitado, bloqueio após
excedido, chaves independentes, reset após a janela), `ics.test.ts` (7
casos — geração do `.ics`, escape de texto, formato UTC, `data:` URL),
`format.test.ts` (3 casos — `formatDuration`).

**Total: 201/201 testes passando** (179 no fim da Etapa 2 + 22 novos
nesta etapa: 8 de `errors.test.ts` + 4 de `rate-limit.test.ts` + 7 de
`ics.test.ts` + 3 de `format.test.ts` = 22; zero alterados/removidos de
etapas anteriores).

## CONCORRÊNCIA / TESTES DE SEGURANÇA (matriz completa)

Dois tenants reais (fixture `barbearia-a`/`salao-b`, já usada desde a
P0) com clientes e agendamentos próprios. Tentativas, todas bloqueadas:

| Ataque | Resultado |
| --- | --- |
| Token de A usado para ler o agendamento de B | Nunca acontece — o token só resolve a própria linha, não há "empresa" a informar |
| Token de A usado para cancelar o agendamento de B | Bloqueado — cancelar com o token de A altera só o agendamento de A; o de B permanece `pending` (asserção SQL permanente) |
| Token de A usado para reagendar o agendamento de B | Mesmo mecanismo — impossível por construção, não só por policy |
| `anon` tentando ler `appointments`/`customers` diretamente | Já bloqueado desde a P0/AUDIT-01 (RLS, sem policy de leitura pública) — não tocado nesta etapa |
| Enumeração de agendamentos via listagem pública | Não existe nenhum endpoint de listagem pública — as três novas funções sempre exigem um token exato, nunca retornam mais de uma linha |

✅ **IMPLEMENTADO E VALIDADO**.

## RATE LIMIT E ABUSO

`src/lib/rate-limit.ts` — limitador em memória por processo, aplicado a:
consulta por token (30/10min por IP, em `page.tsx`), cancelamento e
reagendamento (10/10min por IP cada, nas server actions). **Limitação
documentada, não escondida**: é em memória de um único processo — em
produção serverless (Vercel), cada instância/cold start tem seu próprio
mapa, então isso não é um limite global nem sobrevive a um redeploy. A
defesa real contra enumeração de agendamento é a entropia do token (256
bits); o rate limit é uma camada extra barata, não a proteção principal.
Uma implementação com armazenamento compartilhado (Upstash Redis, Vercel
KV) é a evolução recomendada para produção multi-instância — não
implementada nesta etapa por ser infraestrutura externa não disponível
neste ambiente e fora do escopo pedido ("não faça infraestrutura
complexa se não for necessária").

🟡 **IMPLEMENTADO MAS NÃO VALIDADO COM INFRAESTRUTURA REAL** — a lógica
do limitador tem 4 testes unitários (limite respeitado, bloqueio,
chaves independentes, reset por janela), mas o comportamento sob tráfego
real multi-instância (onde a limitação documentada acima importa) nunca
foi testado por não existir uma implantação real neste ambiente.

## PRIVACIDADE

Nenhum endpoint público de listagem existe em nenhuma das três novas
funções — todas exigem um token exato e retornam no máximo uma linha, a
própria. Nenhuma delas aceita `business_id`/`customer_id` como parâmetro
(o único parâmetro é o token, ou token + novo horário no reagendamento).
`get_public_appointment()` nunca retorna dados de negócio administrativos
(sem `owner_id`, sem preço de custo, sem outros agendamentos).

✅ **IMPLEMENTADO E VALIDADO**.

## ERROS

Todas as mensagens do cliente passam por `mapPublicAppointmentError()` —
nunca um stack trace, nunca SQL bruto, nunca o nome de uma função/RPC
interna. Casos cobertos com mensagem própria: horário indisponível
(`slot is no longer available`/`slot is blocked`), fora do expediente
(`closed on this day`/`outside business hours`), fora da janela de
antecedência/prazo (`minimum notice window`/`beyond the booking window`),
token inválido, cancelamento/reagendamento fora do prazo, agendamento que
não pode mais ser alterado (status). Todo erro não reconhecido cai em uma
única mensagem genérica ("Não foi possível concluir a operação. Tente
novamente.") em vez de vazar a mensagem original — testado explicitamente
(`errors.test.ts`, caso "never leaks the raw message").

✅ **IMPLEMENTADO E VALIDADO**.

## QA REAL

Ambiente real (mesmo shim REST↔SQL das etapas anteriores + Postgres 16
descartável com as 14 migrations + `next dev` real + Chromium via
Playwright):

1. Fluxo completo em 390px: página pública → seção Agendamento → Serviço
   → Profissional → Data → Horário → Dados → Revisão → Confirmar →
   Sucesso (com botões "Adicionar ao calendário"/"Compartilhar" e link
   "Gerenciar meu agendamento") → `/agendamento/[token]` real → token
   inválido (mensagem genérica) → cancelamento (confirmação nativa do
   navegador aceita) → tela "Agendamento cancelado".
2. Segundo fluxo completo em 375px, desta vez levado até o reagendamento:
   nova reserva → `/agendamento/[token]` → "Reagendar" → nova data (chip)
   → novo horário → "Confirmar novo horário" → tela de sucesso —
   **conferido também diretamente no banco** (`select starts_at, status
   from appointments where client_token = '...'`) que o novo horário foi
   de fato persistido, não só exibido na tela.
3. Sem scroll horizontal confirmado em 375/390/768px, na página pública e
   em `/agendamento/[token]`.

Screenshots reais capturados e inspecionados em cada etapa (não
presumido a partir do código).

## LIMITAÇÕES

- **Rate limiting em memória** (ver seção própria acima) — funcional para
  um único processo, não para produção serverless multi-instância sem
  trocar por um armazenamento compartilhado.
- **Fluxo autenticado do painel não re-testado nesta etapa** — o
  reagendamento/cancelamento pelo **empresário** (`reschedule_appointment`,
  `updateAppointmentStatus`) não foi alterado e não precisou ser
  reverificado; esta etapa é inteiramente sobre o portal do cliente.
- **"Adicionar ao calendário"/"Compartilhar" são simples de propósito**
  — `.ics` estático via `data:` URL e `navigator.share()`/clipboard,
  nenhuma integração real com Google Calendar (fora de escopo,
  explicitamente pedido para não implementar).
- **E-mail/WhatsApp de confirmação continuam fora de escopo** — o cliente
  recebe o link de gerenciamento na própria tela de sucesso (e pode
  copiá-lo/compartilhá-lo), não por um canal externo, exatamente como
  instruído.

## NÃO IMPLEMENTADO NESTA ETAPA (fora de escopo, deliberado)

WhatsApp, e-mail, lembretes, pagamentos, checkout, buffer entre
atendimentos, "qualquer profissional", pacotes, assinaturas, fidelidade,
staff, marketplace, app nativo, integração completa com Google
Calendar — exatamente a lista que a instrução desta etapa pediu para não
tocar.

## RESULTADO FINAL

| Item | Classificação |
| --- | --- |
| Fluxo de agendamento em 6 passos (mobile-first) | ✅ IMPLEMENTADO E VALIDADO |
| Reaproveitamento do motor P0 (`get_available_slots`/`create_public_appointment`) | ✅ IMPLEMENTADO E VALIDADO |
| Token público de alta entropia | ✅ IMPLEMENTADO E VALIDADO |
| Consulta por token (`/agendamento/[token]`) | ✅ IMPLEMENTADO E VALIDADO |
| Cancelamento pelo cliente, com janela configurável | ✅ IMPLEMENTADO E VALIDADO |
| Reagendamento pelo cliente (reaproveita `validate_appointment_slot`) | ✅ IMPLEMENTADO E VALIDADO |
| Isolamento multi-tenant via token | ✅ IMPLEMENTADO E VALIDADO |
| Concorrência (double-booking) preservada | ✅ IMPLEMENTADO E VALIDADO |
| Mensagens de erro sanitizadas | ✅ IMPLEMENTADO E VALIDADO |
| UX mobile (375/390/768px, sem scroll horizontal) | ✅ IMPLEMENTADO E VALIDADO |
| Rate limiting | 🟡 IMPLEMENTADO MAS NÃO VALIDADO COM INFRAESTRUTURA REAL |
| QA real em navegador (booking + consulta + cancelar + reagendar) | ✅ IMPLEMENTADO E VALIDADO |

### VALIDAÇÃO FINAL

```
npm run lint       → limpo
npm run typecheck  → limpo
npm test           → 201/201 (179 pré-existentes + 22 novos nesta etapa
                      em 4 arquivos, ver "TESTES")
npm run build      → build de produção concluído, 24 rotas, incluindo
                      /agendamento/[token]
```

`supabase/tests/db.sql` — suíte completa (pré-existente + P0 + Etapa 1 +
Etapa 2 + Etapa 3) — `ALL ASSERTIONS PASSED` contra uma aplicação limpa
das 14 migrations; confirmado falhando contra as 13 migrations
anteriores antes de aplicar esta. Concorrência real (2 processos `psql`
paralelos) reconfirmada com o schema desta etapa: 1 sucesso, 1 rejeição
amigável.

**Arquivos alterados/criados**: `supabase/migrations/
20250924120014_client_booking_portal.sql` (nova), `supabase/tests/db.sql`,
`src/types/database.ts`, `src/lib/validations.ts`, `src/lib/format.ts`
(+teste), `src/lib/rate-limit.ts` (novo, +teste), `src/lib/request-ip.ts`
(novo), `src/lib/ics.ts` (novo, +teste), `src/app/[slug]/booking-widget.tsx`
(reescrito como wizard), `src/app/[slug]/booking-success.tsx` (novo),
`src/app/[slug]/renderer/booking-section.tsx`, `src/app/robots.ts`,
`src/app/agendamento/[token]/` (novo: `page.tsx`, `actions.ts`,
`appointment-portal.tsx`, `errors.ts` +teste).

**Migrations novas**: `20250924120014_client_booking_portal.sql`.

**Funções/RPCs novas**: `get_public_appointment(p_token)`,
`cancel_public_appointment(p_token)`,
`reschedule_public_appointment(p_token, p_starts_at)` — todas
`SECURITY DEFINER`, `anon`+`authenticated`. **Funções alteradas**:
`is_slug_reserved()` (adiciona `agendamento` à lista). **Nenhuma função
P0 foi alterada** (`validate_appointment_slot`,
`create_public_appointment`, `reschedule_appointment` seguem
byte-a-byte iguais).

**Colunas novas**: `appointments.client_token`,
`business_settings.client_cancellation_min_hours`.

**Endpoints/rotas novas**: `/agendamento/[token]` (página + 2 server
actions: cancelar, reagendar).

**Testes adicionados**: 17 asserções SQL (`db.sql`), 22 testes Vitest
(8 em `errors.test.ts`, 4 em `rate-limit.test.ts`, 7 em `ics.test.ts`,
3 em `format.test.ts`).

**Branch**: `claude/blissful-edison-4wt18p`. `main` não foi tocada nesta
etapa (só na Etapa 0, por instrução explícita).

**Limitações que dependem de infraestrutura externa**: rate limiting
real multi-instância (precisa de Upstash Redis/Vercel KV); autenticação
real (GoTrue) para testar o painel do empresário em paralelo — não
necessário para esta etapa, que é inteiramente sobre o portal público do
cliente.
