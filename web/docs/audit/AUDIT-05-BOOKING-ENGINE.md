# AUDIT-05 — Motor de Agendamento (auditoria profunda)

Auditoria read-only. Nenhum código foi alterado. Todos os testes de
comportamento (disponibilidade, concorrência, duração, buffer, horários,
timezone, dedup de cliente) foram executados contra um Postgres 16
descartável, com as migrations reais aplicadas (`supabase/tests/fixtures/
local-stub.sql` + toda `supabase/migrations/*.sql` em ordem), nunca
produção. Nenhum resumo de conversa anterior foi usado como fonte —
todo achado abaixo foi obtido lendo o código-fonte atual do repositório e
executando SQL real contra o schema real.

## Resultado

**PASS COM RESSALVAS GRAVES.** O núcleo da proteção contra overbooking
(constraint de exclusão no banco) é real e comprovadamente eficaz mesmo
sob concorrência genuína. Porém foram encontradas duas lacunas de
validação server-side que um "frontend correto" mascara mas que qualquer
chamada direta à API/RPC consegue explorar: (1) `create_public_appointment()`
**não verifica `business_hours`/`professional_hours` nem `is_closed`**,
apenas `blocked_times`; (2) o reagendamento feito pelo painel
(`rescheduleAppointment`) **não reaplica nenhuma validação de
disponibilidade** além da constraint de exclusão — nem `blocked_times`,
nem horário de funcionamento, nem antecedência mínima. **Buffer entre
atendimentos: NÃO IMPLEMENTADO.** "Qualquer profissional": **não existe**,
documentado explicitamente abaixo. Cancelamento/reagendamento pelo
próprio cliente: **não existe** nenhum caminho para isso.

## Fluxo completo (cliente anônimo)

Rastreado em `src/app/[slug]/page.tsx` + `src/app/[slug]/booking-widget.tsx`
(client component, ~300 linhas):

1. Visitante abre `/{slug}` — nenhuma autenticação é exigida em nenhum
   momento do fluxo (`grep -n "supabase.auth" src/app/[slug]/booking-widget.tsx`
   não retorna nada).
2. Seleciona um **serviço** (`<select>`, linhas 118-127) — a lista vem de
   `getBusinessPageData()`, que filtra `is_active = true` no servidor
   (confirmado em `AUDIT-03`).
3. Seleciona um **profissional** (`<select>`, linhas 138-146) — populado
   apenas com os profissionais retornados por `getBusinessPageData()`
   (também filtrados por `is_active = true`); não há filtro adicional
   por "esse profissional atende esse serviço" na lista exibida — isso só
   é validado no servidor no momento da escrita (ver "Qualquer
   profissional" abaixo, e a constraint `professional_services`).
4. Escolhe **data** — um `<input type="date">` livre, sem calendário
   custom, sem bloqueio de dias fechados na própria UI (a validação real
   acontece ao carregar os horários do dia).
5. Ao mudar serviço/profissional/data, o componente chama
   `get_available_slots(slug, service_id, professional_id, date)` via RPC
   pública e renderiza os horários retornados como botões. **Os horários
   são 100% calculados no servidor** — o cliente não gera nem filtra
   nada, apenas exibe o array retornado.
6. Escolhe um horário, preenche nome/telefone/e-mail (e-mail opcional),
   confirma.
7. O submit chama `create_public_appointment(slug, service_id,
   professional_id, starts_at, name, phone, email)` via RPC pública.
8. Tela de sucesso: mensagem fixa + data/hora formatada
   (`booking-widget.tsx:87-101`). Nenhum ID de agendamento é exibido.

**O cliente nunca precisa de conta.** Confirmado por ausência total de
qualquer chamada de auth no componente e pelo fato de `create_public_appointment`
e `get_available_slots` serem as duas únicas funções com
`grant execute ... to anon` em toda a base de migrations
(`grep -rn "grant execute.*to anon" supabase/migrations/`).

### Serviços/profissionais inativos ou incompatíveis aparecem?

Testado contra o banco real:

| Cenário | Resultado |
| --- | --- |
| Serviço com `is_active = false` | Não aparece na lista pública (`getBusinessPageData` filtra) e `create_public_appointment` rejeita com `service not found` mesmo se o ID for forjado manualmente |
| Profissional com `is_active = false` | Idem — não aparece, e a RPC rejeita com `professional not found` |
| Profissional que não atende aquele serviço | Aparece na lista de profissionais (a lista não é filtrada por serviço), mas **a RPC rejeita a combinação** com `professional does not offer this service` (`professional_services` checada explicitamente, linhas 120-124 de `create_public_appointment`) — ou seja, a UI permite montar a combinação errada, mas o servidor barra na escrita |

## Disponibilidade — cálculo server-side

Confirmado em `get_available_slots()` (`supabase/migrations/20250924120005_functions.sql:90-202`,
reafirmado aqui): usa `professional_hours` se existir linha para o dia da
semana, senão cai para `business_hours`; itera em passos de
`slot_interval_minutes`; exclui horários que violem `min_notice_minutes`,
que colidam com `blocked_times`, ou que colidam com agendamentos
não-cancelados existentes. **100% calculado no Postgres, dentro de uma
função `SECURITY DEFINER`** — o cliente não tem acesso a nenhuma dessas
tabelas diretamente (sem policy de leitura para `anon` em nenhuma delas).

## Concorrência (teste real, dois processos simultâneos)

Reexecutado nesta auditoria, na fixture própria deste documento (não
reaproveitando o teste de auditorias anteriores), com **dois processos
`psql` disparados em paralelo de fato** contra a mesma combinação de
negócio/serviço/profissional/data/horário:

```
create_public_appointment('empresa-e-a5', <service>, <professional>,
  <mesmo horário exato>, 'Cliente Concorrente A', '+55...1111') &
create_public_appointment('empresa-e-a5', <service>, <professional>,
  <mesmo horário exato>, 'Cliente Concorrente B', '+55...2222') &
wait
```

Resultado: **exatamente um dos dois processos recebeu o agendamento**; o
outro recebeu `ERROR: slot is no longer available` (a função converte
`exclusion_violation`/`deadlock_detected` nessa mensagem — código
`23P01`). A proteção real é a constraint:

```
exclude using gist (professional_id with =, tstzrange(starts_at, ends_at) with &&)
where (status <> 'cancelled')
```

(`schema.sql:244-248`) — **existe no banco**, não depende de nenhum
comportamento de frontend. Também foi confirmado que uma tentativa de
inserir 5 minutos dentro do intervalo de um agendamento já existente
(não uma colisão exata de horário, apenas sobreposição parcial) é
igualmente rejeitada pela mesma constraint — o range completo do serviço
é protegido, não só o instante de início.

**Não foi aceito como prova "o frontend desabilita o botão"** — o teste
acima chama a função diretamente via SQL, sem nenhum código de
aplicação envolvido.

## Duração (30/45/60/90 minutos)

Testado com os 4 serviços da fixture (`Serviço 30/45/60/90`), cada um
agendado em um horário isolado dentro do expediente (08:00-20:00 local),
e confirmado via `ends_at - starts_at`:

| Serviço | Início (local) | Fim (local) | Intervalo ocupado |
| --- | --- | --- | --- |
| 30 min | 08:00 | 08:30 | `00:30:00` ✅ |
| 45 min | 10:00 | 10:45 | `00:45:00` ✅ |
| 60 min | 12:00 | 13:00 | `01:00:00` ✅ |
| 90 min | 16:00 | 17:30 | `01:30:00` ✅ |

Confirmado adicionalmente que o intervalo inteiro fica protegido, não só
a borda: uma tentativa de agendar às 08:05 (5 minutos dentro do
agendamento de 30 min criado às 08:00) foi rejeitada pela constraint de
exclusão (`ERROR: slot is no longer available`).

## Buffer

**BUFFER NÃO IMPLEMENTADO.** Não existe nenhuma coluna, configuração ou
lógica de intervalo de segurança entre atendimentos em nenhum lugar do
schema ou das funções lidas (`grep -rn "buffer" supabase/ src/` não
retorna nenhuma ocorrência relacionada a agendamento — a única
combinação de letras parecida encontrada é irrelevante). Confirmado
também por teste ao vivo, reaproveitando a evidência da `AUDIT-03`: um
agendamento imediatamente colado ao fim de outro (sem nenhum intervalo)
é aceito normalmente pela constraint de exclusão, que só rejeita
sobreposição, nunca proximidade. Isso não é considerado implementado
apesar de tabelas como `professional_hours`/`business_hours` existirem —
nenhuma delas tem coluna de buffer/intervalo de descanso.

## Qualquer profissional ("any professional")

**Não existe.** Evidências:

1. `grep -rni "qualquer.profissional\|any.professional"` em todo `src/`
   e `supabase/` → nenhuma ocorrência.
2. O `<select>` de profissional em `booking-widget.tsx:138-146` só lista
   `"Selecione..."` + um `<option>` por profissional real — nenhuma
   opção "qualquer" ou equivalente.
3. Testado diretamente contra a função: chamar `create_public_appointment`
   com `p_professional_id = null` retorna `ERROR: professional not
   found` — a função exige um profissional específico, ativo e existente;
   **não há nenhum suporte latente** a um modo "qualquer profissional"
   dentro da própria função (não é um caso de "existe no banco mas falta
   UI" — a função rejeita explicitamente).
4. Consequentemente, as perguntas "filtra por quem oferece o serviço,
   está ativo, disponível e sem conflito" não se aplicam: **documentado
   explicitamente que o recurso não existe em nenhuma camada.**

## Clientes (dedup por telefone)

Testado ao vivo, dois agendamentos com o mesmo telefone:

| Passo | Nome enviado | E-mail enviado | Resultado no banco |
| --- | --- | --- | --- |
| 1º agendamento | "Ciclano Original" | `ciclano@original.com` | Cria `customers` novo |
| 2º agendamento (mesmo telefone) | "Ciclano Renomeado" | *(vazio)* | **Mesmo `customer_id`** (confirmado, `same_id = t`); `name` atualizado para "Ciclano Renomeado" **incondicionalmente**; `email` preservado como `ciclano@original.com` (não foi apagado pelo campo vazio) |

Confirma exatamente a lógica de `create_public_appointment` (linhas
147-160): chave de identidade é só `(business_id, phone)`; nome é
sobrescrito a cada novo agendamento mesmo que o cliente diga um nome
diferente da vez anterior (não há confirmação nem alerta sobre isso);
e-mail só é sobrescrito se o novo valor não for vazio
(`coalesce(nullif(...), email)`). Não há verificação de identidade além
do telefone — dois nomes completamente diferentes com o mesmo telefone
são tratados como a mesma pessoa silenciosamente.

## Cancelamento

- **Pelo empresário:** existe via `updateAppointmentStatus`
  (`src/app/dashboard/appointments/actions.ts:24-42`) — um `UPDATE`
  direto de `status` para qualquer valor do enum
  (`pending/confirmed/cancelled/completed/no_show`), sem nenhuma
  restrição. **Não há política de antecedência mínima para cancelar**:
  o empresário pode cancelar um agendamento que começa em 1 minuto ou
  que já passou, sem aviso. Não há também validação de transição de
  estado (ex.: nada impede marcar um agendamento já `completed` de volta
  para `pending`).
- **Pelo cliente:** **não existe.** Não há nenhuma rota, função RPC
  `anon`-executável, nem link/token de cancelamento em nenhuma
  notificação. O cliente não tem absolutamente nenhuma forma de cancelar
  o próprio agendamento depois de confirmado — precisa entrar em contato
  direto com o empresário por fora do sistema.

## Reagendamento

- **Pelo empresário:** existe via `rescheduleAppointment`
  (`src/app/dashboard/appointments/actions.ts:47-130`). **Achado grave,
  novo nesta auditoria:** a única proteção contra um reagendamento
  inválido é a constraint de exclusão do Postgres (capturada pelo código
  `23P01`) — a função **não reconsulta `blocked_times`, não reconsulta
  `business_hours`/`professional_hours`, não reaplica `min_notice_minutes`
  nem `booking_window_days`**. Reproduzido ao vivo:
  1. Criado um `blocked_times` de 14:00-16:00 local para um profissional.
  2. Confirmado que `create_public_appointment` respeita o bloqueio
     corretamente (`ERROR: slot is blocked`).
  3. Reproduzido o `UPDATE` exato que `rescheduleAppointment` executa
     (mesma forma: `update appointments set starts_at=.., ends_at=..
     where id=.. and business_id=..`) movendo um agendamento existente
     para dentro desse mesmo bloqueio de 14:30-15:00 — **o `UPDATE`
     teve sucesso, sem nenhum erro**, colocando o agendamento
     exatamente dentro do horário bloqueado do profissional.
  Ou seja: o mesmo horário que a página pública corretamente recusa por
  estar bloqueado pode ser alcançado pelo próprio painel do empresário ao
  reagendar, sem aviso nenhum de que aquele horário está marcado como
  indisponível.
- **Pelo cliente:** **não existe**, pelo mesmo motivo do cancelamento —
  nenhuma rota/RPC pública para isso.

## Timezone (America/Sao_Paulo)

Testado de ponta a ponta nesta e nas auditorias anteriores, agora
reconfirmado incluindo o caminho de notificação:

- **Armazenamento:** todas as colunas de horário são `timestamptz`
  (UTC internamente) — confirmado no schema.
- **Leitura/disponibilidade:** `get_available_slots` opera comparando
  `timestamptz` diretamente, sem conversão manual de fuso — correto por
  construção.
- **Escrita:** o widget converte o horário local escolhido pelo visitante
  para `timestamptz` antes de enviar (`at time zone` implícito na própria
  chamada RPC neste teste, e via `zonedDateTimeToUtcISO` no código do
  reagendamento do painel).
- **Reagendamento:** `rescheduleAppointment` usa
  `zonedDateTimeToUtcISO(date, time, business.timezone)` — o comentário
  no próprio código (linhas 91-94) explica corretamente por que não usar
  o fuso do servidor. Testado e correto.
- **Notificações:** confirmado em `supabase/migrations/20250924120007_notifications.sql:193-194`
  — os textos de data/hora usados nas notificações usam
  `new.starts_at at time zone coalesce(v_business.timezone,
  'America/Sao_Paulo')`, ou seja, exibem no fuso da própria empresa, não
  em UTC nem no fuso do servidor.
- **Exibição ao cliente:** a tela de confirmação formata a data/hora
  recebida do servidor (já no fuso correto) sem reconversão adicional.

Nenhuma inconsistência de timezone encontrada em nenhum ponto do fluxo.

## Segurança

- **Confirmação não expõe dados internos na tela:** `booking-widget.tsx:87-101`
  mostra apenas uma mensagem de sucesso fixa + data/hora formatada — sem
  ID, sem dados de outros clientes, sem detalhes internos.
- **Ressalva técnica:** a função `create_public_appointment` tem tipo de
  retorno `public.appointments%rowtype`, ou seja, **a resposta de rede da
  RPC contém a linha completa** (incluindo `id`, `customer_id`,
  `professional_id`, `service_id`, todos UUIDs internos) mesmo que o
  componente atual nunca leia esses campos. Não é um vazamento ativo
  hoje (o dado só existe na resposta HTTP da chamada RPC do próprio
  navegador do cliente, não em uma página pública indexável), mas é uma
  superfície desnecessária — qualquer um inspecionando a aba de rede do
  navegador consegue ver esses IDs internos.
- **Nenhuma escrita pública além da criação de agendamento:** confirmado
  que `get_available_slots` e `create_public_appointment` são as únicas
  funções `anon`-executáveis relacionadas a agendamento; não há
  `update`/`delete` públicos.
- **IDOR:** já confirmado em `AUDIT-02`/`AUDIT-01` que nenhuma tabela
  relacionada (`appointments`, `customers`) tem policy de leitura para
  `anon`.

## Achados graves (não documentados nas auditorias 1-4)

1. **`create_public_appointment()` não verifica `business_hours`,
   `professional_hours` nem a flag `is_closed`.** Reproduzido duas
   vezes ao vivo:
   - Agendamento criado com sucesso às **02:00 local**, 6 horas antes da
     abertura (08:00), enquanto `get_available_slots` corretamente
     retornava zero horários antes das 08:00 para o mesmo dia.
   - Um domingo marcado explicitamente como `is_closed = true` em
     `business_hours` aceitou um agendamento às 10:00 local via a RPC,
     enquanto `get_available_slots` corretamente retornava zero
     horários para aquele domingo.
   Ou seja: a única coisa que impede um cliente de agendar fora do
   expediente é a lista de horários oferecida pela própria interface —
   quem chamar a função diretamente (API pública, `anon`) não encontra
   nenhuma barreira de horário no servidor, só `blocked_times`,
   antecedência mínima e janela de agendamento.
2. **`rescheduleAppointment()` (painel) não reaplica `blocked_times`,
   horário de funcionamento nem antecedência mínima** — só a constraint
   de exclusão. Reproduzido ao vivo movendo um agendamento existente
   para dentro de um `blocked_times` ativo, com sucesso.
3. **"Qualquer profissional" não existe em nenhuma camada** (UI nem
   função) — documentado conforme exigido.
4. **Buffer entre atendimentos: NÃO IMPLEMENTADO** em nenhuma tabela,
   coluna ou função.
5. **Nenhum caminho de cancelamento/reagendamento pelo próprio cliente.**
6. **`updateAppointmentStatus` não tem política de antecedência mínima
   para cancelamento** nem validação de transição de estado.

## Requisitos não implementados

- Buffer/intervalo de segurança entre atendimentos.
- "Qualquer profissional automático".
- Cancelamento e reagendamento iniciados pelo cliente.
- Validação de horário de funcionamento na escrita (só existe na
  leitura/disponibilidade).
- Revalidação completa de disponibilidade no reagendamento pelo painel.
- Política de antecedência mínima para cancelamento pelo empresário.

## Testes executados

Todos contra Postgres real (nunca produção), fixture própria desta
auditoria:

1. Leitura completa de `create_public_appointment()` (versão final,
   `20250924120009_audit_hardening.sql:71-185`) e `get_available_slots()`.
2. Leitura completa de `src/app/dashboard/appointments/actions.ts` (131
   linhas) e `src/app/[slug]/booking-widget.tsx`.
3. Concorrência real: dois processos `psql` simultâneos para o mesmo
   slot — um sucesso, um `23P01`.
4. Duração: 4 agendamentos (30/45/60/90 min) com verificação exata de
   `ends_at - starts_at`; teste de sobreposição parcial (5 min dentro de
   um intervalo já ocupado) rejeitado.
5. Horário fora do expediente (02:00, antes da abertura): aceito pela
   RPC, ausente em `get_available_slots`.
6. Dia marcado `is_closed = true`: aceito pela RPC, ausente em
   `get_available_slots`.
7. Reagendamento do painel para dentro de um `blocked_times` ativo:
   RPC pública recusa corretamente o mesmo horário; `UPDATE` direto
   (equivalente ao código do painel) aceita sem erro.
8. Dedup de cliente: mesmo telefone, nomes diferentes, e-mail omitido na
   segunda vez — mesmo `customer_id`, nome sobrescrito, e-mail
   preservado.
9. `p_professional_id = null` → `professional not found` (sem suporte
   latente a "qualquer profissional").
10. Grep de "qualquer profissional"/"any professional" em todo o
    repositório → vazio.
11. Grep de `grant execute ... to anon` em todas as migrations →
    confirma só `get_available_slots` e `create_public_appointment`.

## Recomendações

1. Adicionar verificação de `business_hours`/`professional_hours`/
   `is_closed` dentro de `create_public_appointment()` — hoje a única
   barreira é a UI, o que não protege uma chamada direta à API pública.
2. Reescrever `rescheduleAppointment()` para reaplicar exatamente as
   mesmas validações do agendamento público (`blocked_times`, horário de
   funcionamento, antecedência mínima, janela de agendamento) antes do
   `UPDATE`, não só confiar na constraint de exclusão.
3. Decidir, com quem definiu o escopo, se buffer e "qualquer
   profissional" são requisitos reais pendentes ou funcionalidades que
   nunca foram de fato parte do escopo — ambos exigem desenho de schema
   novo, não são ajustes pequenos.
4. Se cancelamento/reagendamento pelo cliente for um requisito, desenhar
   um mecanismo de identidade do cliente sem conta (ex.: token assinado
   por agendamento, enviado por WhatsApp/e-mail) — hoje não existe
   nenhuma base para isso.
5. Adicionar política de antecedência mínima para cancelamento pelo
   empresário, se for um requisito de negócio.
6. Considerar não retornar a linha completa de `appointments` da RPC
   pública — hoje o retorno expõe UUIDs internos que o cliente nunca
   deveria precisar ver.
