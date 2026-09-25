# AUDIT-03 — Serviços, Profissionais, Horários e Disponibilidade

Auditoria read-only. Nenhum código foi alterado. Todos os 12 cenários
pedidos e a proteção contra overbooking foram executados de verdade
contra um Postgres 16 descartável com as migrations reais aplicadas
(nunca produção) — não foram inferidos da leitura do código.

## Resultado

**PASS COM RESSALVAS**

O motor de disponibilidade (`get_available_slots()`) é robusto, testado
com dados reais nos 12 cenários pedidos, e a proteção contra overbooking
é real (constraint de banco, confirmada sob concorrência genuína, não
apenas checagem de aplicação). As ressalvas: um campo esperado (buffer)
não existe; uma tabela inteira (`professional_hours`) existe no banco e é
consultada pelo motor, mas não tem nenhuma tela no dashboard para
gerenciá-la; profissionais não têm campo de foto administrável apesar da
coluna existir e ser exibida na página pública; e o modelo de horário
(um turno por dia) não suporta múltiplos intervalos no mesmo dia.

## Serviços

CRUD real em `src/app/dashboard/services/actions.ts`:

| Operação | Existe? | Evidência |
| --- | --- | --- |
| Criar | Sim | `createService`, linhas 12-50 |
| Editar | Sim | `updateService`, linhas 52-91 |
| Ativar/Desativar | Sim (campo `is_active`, não uma ação separada) | `updateService`, campo `is_active` do form |
| Arquivar | **Não existe como conceito distinto** | não há status "arquivado"; só `is_active` (boolean) e exclusão definitiva (`deleteService`) |
| Reordenar | Sim | `moveService`, linhas 106-141 — reordenação real, reescreve `position` de toda a lista, não só troca dois valores |

Campos da tabela `services` (`supabase/migrations/20250924120002_schema.sql:85-96`):
`name`, `description`, `duration_minutes`, `price_cents`, `is_active`,
`position`. **Não existe coluna `buffer`** — confirmado por leitura
direta do `create table` e por `grep -ri "buffer"` em todo o
repositório, que não retorna nenhuma ocorrência em código de produto
(só em comentários de teste que documentam explicitamente a ausência
do recurso — ver seção "Regras NÃO aplicadas").

## Profissionais

CRUD em `src/app/dashboard/professionals/actions.ts`:

| Operação | Existe? | Evidência |
| --- | --- | --- |
| Criar | Sim | `createProfessional`, linhas 16-64 |
| Editar | Sim | `updateProfessional`, linhas 66-116 |
| Ativar/Desativar | Sim | campo `is_active` no form de edição |
| Excluir | Sim, com fallback | `deleteProfessional` tenta excluir; se houver agendamentos vinculados (`on delete restrict` na FK de `appointments.professional_id`), cai para `is_active = false` em vez de falhar (linhas 120-141) |
| Foto (`avatar_url`) | **Coluna existe, sem UI para definir** | `grep -rn "avatar_url" src/` só encontra a coluna nos tipos gerados e sendo **lida/renderizada** em `src/app/[slug]/page.tsx:215-217` — nenhum arquivo do dashboard (`professionals/actions.ts`, `new-professional-form.tsx`, `professional-row.tsx`) referencia `avatar_url`. Não há como o empresário definir a foto de um profissional através do produto. |
| Bio | Sim | campo `bio`, coletado e salvo |
| Vínculo com serviços | Sim | ver seção dedicada abaixo |
| Vínculo com horários (`professional_hours`) | **Tabela existe, sem UI** | ver "Horários" abaixo |
| Reordenar | **Não existe** | `grep -n "export async function" professionals/actions.ts` não lista nenhuma função de mover/reordenar (ao contrário de `services`, que tem `moveService`) |

## Relação profissional ↔ serviço

Tabela `professional_services` (`schema.sql:129-137`), chave primária
composta `(professional_id, service_id)` — testada com dados reais:

- **Profissional A atende serviço X**: criado o vínculo, `get_available_slots()`
  retornou slots normalmente.
- **Profissional B não atende serviço X**: sem o vínculo,
  `get_available_slots('empresa-d-t3', <servico>, <profissional-sem-vinculo>, <data>)`
  retornou **0 linhas** — a função checa isso explicitamente
  (`supabase/migrations/20250924120005_functions.sql:135-140`, `if not
  exists (select 1 from professional_services where...) then return;`).
  Confirmado por teste real, não só pela leitura do código.
- O mesmo vínculo também é a fonte de verdade do lado do cliente: em
  `src/app/[slug]/booking-widget.tsx:50-55`, a lista de profissionais
  oferecida no seletor já é filtrada por
  `servicesByProfessional.get(p.id)?.includes(serviceId)` — a UI nunca
  chega a oferecer a combinação errada, e o banco recusaria mesmo que
  chegasse.

## Horários

- **Horário da empresa** (`business_hours`): CRUD real em
  `src/app/dashboard/hours/actions.ts`, um registro por dia da semana
  (`unique(business_id, day_of_week)`).
- **Horário por profissional** (`professional_hours`): **a tabela
  existe** (mesma estrutura de `business_hours`, migration
  `schema.sql:162-176`, com RLS, trigger e constraint de faixa válida)
  **e é efetivamente consultada pelo motor de disponibilidade** —
  `get_available_slots()` tenta `professional_hours` primeiro e só cai
  para `business_hours` se não achar uma linha para aquele profissional
  naquele dia (`functions.sql:154-166`). Mas **nenhum arquivo do
  dashboard a referencia** (`grep -rln "professional_hours" src/` só
  retorna o arquivo de tipos gerados) — não existe tela, formulário nem
  server action para o empresário cadastrar um horário específico de um
  profissional. É um recurso "meio construído": o motor sabe usá-lo, o
  produto não sabe alimentá-lo.
- **Múltiplos intervalos no mesmo dia** (ex: 09-12 e 14-18 com pausa de
  almoço nativa): **não suportado**. `business_hours`/
  `professional_hours` têm `unique(..., day_of_week)` — só uma linha
  (um `start_time`/`end_time`) por dia é possível. Um intervalo de
  almoço só pode ser modelado como um `blocked_times` recorrente
  (criado manualmente todo dia), não como parte nativa do horário.
- **Dia fechado**: suportado via `is_closed = true` — testado (cenário
  2 abaixo).
- **Folgas**: cobertas por `blocked_times` com `professional_id`
  preenchido (bloqueio só daquele profissional).
- **Bloqueios**: cobertos por `blocked_times` com `professional_id`
  nulo (bloqueio de toda a empresa) ou preenchido (só um profissional).
  CRUD em `src/app/dashboard/blocked-times/actions.ts`.
- **Horários excepcionais** (ex: horário especial num feriado, diferente
  do padrão semanal): **não existe**. O sistema só tem o padrão semanal
  fixo (`day_of_week`) e bloqueios (que só fecham, nunca abrem um
  horário diferente do padrão).

## Motor de disponibilidade

**Arquivo**: `supabase/migrations/20250924120005_functions.sql`
**Função**: `public.get_available_slots(p_business_slug, p_service_id, p_professional_id, p_date)`, linhas 90-202.

### Regras aplicadas (confirmado por leitura + teste real)

1. Empresa publicada (`is_published = true`) — linhas 117-121.
2. Serviço ativo e pertencente à empresa — linhas 123-127.
3. Profissional ativo e pertencente à empresa — linhas 129-133.
4. Profissional realmente atende aquele serviço (`professional_services`) — linhas 135-140.
5. Data dentro da janela de agendamento (`booking_window_days`, padrão 30) — linhas 145-148.
6. Horário do dia: **`professional_hours` primeiro, `business_hours`
   como fallback** — linhas 154-166.
7. Dia fechado → sem slots — linha 168.
8. Varredura em passos de `slot_interval_minutes` (padrão 30) — linha 197.
9. Antecedência mínima (`min_notice_minutes`, padrão 60) — linha 178.
10. Sem sobreposição com `blocked_times` (da empresa toda ou só daquele
    profissional) — linhas 179-184.
11. Sem sobreposição com `appointments` existentes daquele profissional
    (excluindo cancelados) — linhas 185-190.
12. Timezone: toda conversão usa `v_business.timezone` explicitamente
    (`at time zone`), nunca o timezone da sessão do Postgres.

### Regras NÃO aplicadas

- **Buffer entre agendamentos**: não existe. Testado com dados reais —
  um agendamento das 10:00–10:30 deixa o slot das 10:30 disponível
  imediatamente (sem intervalo). O comportamento já era documentado como
  intencional em `supabase/tests/db.sql` (auditoria anterior), e este
  comando reconfirma que segue assim.
- **Checagem de conflito por cliente**: a função só verifica sobreposição
  por `professional_id`. Um mesmo `customer_id` poderia (em tese) ter
  dois agendamentos com profissionais diferentes no mesmo horário — não
  é impedido pelo motor. Risco baixo (o cliente é quem se prejudicaria),
  mas é uma regra ausente que o comando pediu para mapear.
- **Múltiplos turnos no mesmo dia**: ver "Horários" acima.
- **Horário excepcional por data específica**: ver "Horários" acima.

## Tabelas consultadas pela função

`businesses`, `services`, `professionals`, `professional_services`,
`business_settings`, `professional_hours`, `business_hours`,
`blocked_times`, `appointments`. Nenhuma consulta a `customers` (a
função não precisa saber quem é o cliente para calcular disponibilidade
— faz sentido, mas registrado porque o comando pediu "quais tabelas são
consultadas").

## Testes executados (12 cenários pedidos, todos contra banco real)

Fixture: Empresa D, "Serviço Curto" (30min), "Serviço Longo" (90min),
"Prof Ativo" (atende os dois serviços; testado com e sem vínculo ao
serviço longo, ver item 4/5), "Prof Inativo" (`is_active=false`),
horário comercial 09:00–12:00 de segunda a sábado, domingo fechado,
antecedência mínima 60min, intervalo de slot 30min.

| # | Cenário | Resultado |
| --- | --- | --- |
| 1 | Dia livre (segunda) | 6 slots retornados (3h ÷ 30min) |
| 2 | Dia fechado (domingo) | 0 slots |
| 3 | Serviço de 30min | 6 slots de 30min cada, do início ao fim exato do expediente |
| 4 | Serviço de 90min | 4 horários de início possíveis (09:00, 09:30, 10:00, 10:30) — todos os que ainda cabem antes das 12:00 |
| 5 | Serviço maior que o tempo restante | Confirmado pelo item 4: um início às 11:00 (90min terminaria 12:30) **não aparece** na lista — a função descarta corretamente |
| 6 | Horário ocupado | Após criar um agendamento das 10:00–10:30, esse horário desaparece da lista; os demais permanecem |
| 7 | Bloqueio | Após criar um `blocked_times` das 11:00–11:30, esse horário desaparece; os demais permanecem |
| 8 | Profissional indisponível (`is_active=false`) | 0 slots |
| 9 | Profissional sem aquele serviço | 0 slots |
| 10 | Dois horários consecutivos | O horário imediatamente após um agendamento existente (10:30, logo após 10:00–10:30) aparece como disponível |
| 11 | Buffer | Confirmado ausente pelo item 10 |
| 12 | Timezone America/Sao_Paulo | Todos os testes acima usaram `America/Sao_Paulo` (timezone padrão de `create_business()`); os horários retornados em UTC batem exatamente com o esperado em horário local (ex: expediente 09:00–12:00 local = 12:00–15:00 UTC nos resultados brutos) |

## Proteção de banco contra conflito de horário

**Existe e é real**, não apenas uma checagem de aplicação:
`appointments` tem `exclude using gist (professional_id with =,
tstzrange(starts_at, ends_at) with &&) where (status <> 'cancelled')`
(`schema.sql:244-248`).

Testado sob **concorrência genuína** (dois processos `psql` disparados
em paralelo de verdade via bash, não um teste sequencial) tentando criar
`create_public_appointment()` para o mesmo profissional/horário
simultaneamente: um dos dois teve sucesso, o outro recebeu o erro
tratado "slot is no longer available" — o Postgres serializou a
disputa no nível da constraint, não a aplicação.

## Falhas encontradas

Nenhuma falha de correção nos testes acima — todos os 12 cenários e a
proteção contra overbooking se comportaram exatamente como o motor
promete. As falhas são de **completude de produto**, listadas em
"Regras faltantes" e nas tabelas de Serviços/Profissionais/Horários
acima.

## Riscos

- `professional_hours` ser consultado pelo motor mas não gerenciável
  pela UI é um risco de expectativa: um desenvolvedor futuro pode supor
  que, por não haver tela, a tabela é morta e removê-la ou ignorá-la —
  quando na verdade, se alguém inserir linhas diretamente (ex: via SQL
  administrativo), o motor passa a respeitá-las silenciosamente.
- Ausência de checagem de conflito por cliente é um risco de experiência
  (um cliente podendo, em teoria, ser agendado duas vezes no mesmo
  horário com profissionais diferentes), não de segurança.

## Recomendações

1. Decidir se `professional_hours` é um requisito ainda válido; se sim,
   construir a tela que falta (`/dashboard/professionals/[id]/horarios`
   ou equivalente); se não, considerar remover a tabela para não deixar
   um comportamento "invisível" no motor.
2. Adicionar upload de foto ao formulário de profissional (a coluna
   `avatar_url` e a renderização na página pública já existem — falta
   só a escrita).
3. Se buffer entre agendamentos for um requisito real, ele precisa de
   uma coluna nova (`buffer_minutes` em `services` ou
   `business_settings`) e um ajuste em `get_available_slots()`/
   `create_public_appointment()` para expandir a janela de conflito
   considerada.
4. Se múltiplos turnos por dia forem necessários (ex: pausa de almoço
   nativa), o modelo de `business_hours`/`professional_hours` precisa
   mudar de "uma linha por dia" para "N linhas por dia" (remover o
   `unique(..., day_of_week)` e ajustar a função de slots para iterar
   sobre todos os turnos do dia, não um só).
5. Adicionar `moveProfessional` (reordenação) para paridade com
   `services`, se a ordem de exibição dos profissionais na página
   pública for relevante.
