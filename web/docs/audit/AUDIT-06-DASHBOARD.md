# AUDIT-06 — Painel do Empresário (Dashboard)

Auditoria read-only. Nenhum código foi alterado. Achados de comportamento
(exclusão bloqueada por FK, papéis owner/staff) confirmados contra um
Postgres 16 descartável com as migrations reais aplicadas, nunca produção.
Nenhum resumo de conversa anterior foi usado como fonte — todo achado
abaixo vem da leitura do código atual e de testes reais.

## Resultado

**PASS COM RESSALVAS.** O painel cobre de fato todas as áreas
operacionais esperadas, com dados reais (nenhuma métrica mockada), boas
proteções de tenant (toda query filtra `business_id`) e boas
confirmações em ações destrutivas. As ressalvas são: (1) uma
inconsistência real entre `deleteService` e `deleteProfessional` — a
segunda tem fallback de soft-delete quando bloqueada por
`appointments`, a primeira não, e falha **silenciosamente**; (2) o papel
"staff" é reforçado corretamente por RLS e por parte das telas
administrativas, mas **não existe nenhuma forma de criar um usuário
staff no produto** — é um recurso de schema sem UI de convite; (3) a
tela de Personalização não esconde o formulário de quem não é
proprietário, ao contrário de Configurações e Plano, que escondem
corretamente.

## Menu

Comparado à lista esperada (visão geral, agenda, agendamentos, serviços,
profissionais, clientes, horários, personalização, configurações,
notificações, plano), lido em `src/app/dashboard/nav-links.ts`:

| Item esperado | Existe no menu? |
| --- | --- |
| Visão geral | Sim (`/dashboard`) |
| Agenda | Sim |
| Agendamentos | Sim |
| Serviços | Sim |
| Profissionais | Sim |
| Clientes | Sim |
| Horários | Sim |
| Personalização | Sim (rota interna ainda chamada `customization`) |
| Configurações | Sim |
| Plano | Sim |
| **Notificações** | **Não está no menu lateral/superior.** A página `/dashboard/notifications` existe e é completa (lista + marcar como lida), mas só é alcançável pelo sininho no cabeçalho, nunca por um item de navegação — quem não notar o sininho não descobre essa página |

Item extra, não pedido mas existente: **Bloqueios** (`/dashboard/blocked-times`), útil e coerente com o resto do produto.

## Visão geral (métricas)

Lido `src/app/dashboard/page.tsx` por completo. **Todas as 6 métricas
são calculadas a partir de queries reais no banco**, nenhuma é mockada
ou fixa:

| Métrica | Fonte real |
| --- | --- |
| Agendamentos hoje | `count` de agendamentos do dia (fuso da empresa) excluindo cancelados |
| Pendentes de confirmação | `count(*) where status = 'pending'` |
| Cancelamentos hoje | Filtro em memória dos agendamentos do dia com `status = 'cancelled'` |
| Clientes cadastrados | `count(*)` de `customers` |
| Serviços ativos | `count(*) where is_active = true` |
| Ocupação hoje | `minutos_ocupados_hoje / minutos_de_expediente_hoje`, usando `business_hours` do dia da semana atual e a soma real de `duration_minutes` dos agendamentos ativos de hoje; mostra "Fechado hoje" ou "Sem horário definido" nos casos degenerados |

"Agenda de hoje" e "Próximos agendamentos" (seção inferior) também usam
`fetchAppointmentsWithRelations` contra o banco real, com link direto
para o agendamento e para a página pública.

## Agenda (dia/semana/mês)

Lido `src/app/dashboard/agenda/page.tsx` (211 linhas) + `day-view.tsx` +
`week-view.tsx` + `month-view.tsx`:

- As 3 visualizações existem e trocam via querystring (`?view=day|week|month`).
- Filtro por profissional existe (`ProfessionalFilter`, populado com os
  profissionais reais da empresa, ordenados por `position`).
- Navegação anterior/próximo/hoje existe e respeita a unidade da visão
  atual (dia ±1, semana ±7, mês ±1 mês).
- Faixa de datas de cada visão é calculada corretamente
  (`startOfWeekKey`/`startOfMonthKey`/`daysInMonth`) e convertida para um
  intervalo `timestamptz` real via `rangeISO(...)` no fuso da empresa.
- Eventos vêm de `fetchAppointmentsWithRelations`, sempre excluindo
  cancelados e sempre filtrados por `business_id` — nenhuma visão herdada
  de outra empresa é possível.
- Clique em qualquer evento leva ao detalhe do agendamento
  (confirmado via revisão dos 3 componentes de visão).

## Agendamentos (lista)

Lido `src/app/dashboard/appointments/page.tsx` (107 linhas) +
`appointment-row.tsx` + `filters-form.tsx`:

- Filtros reais: status (todos os 5 valores do enum), profissional,
  período (próximos/anteriores/todos) e busca textual (`q`) — todos
  aplicados como parâmetros de query real em
  `fetchAppointmentsWithRelations`, não filtrados em memória.
- Cada linha mostra data/hora, cliente, telefone, serviço, profissional,
  preço e status.
- Ações por status, coerentes com a máquina de estados esperada:
  - `pending` → Confirmar / Cancelar
  - `confirmed` → Concluir / Não compareceu / Cancelar
  - `cancelled`/`completed`/`no_show` → nenhuma ação (estado final)
- Ações destrutivas (cancelar, não compareceu) usam `ConfirmSubmitButton`
  com mensagem de confirmação; ações não destrutivas (confirmar,
  concluir) são um clique direto — consistente com o padrão de risco de
  cada ação.
- **Ressalva já registrada em `AUDIT-05`:** `updateAppointmentStatus`
  não tem nenhuma política de antecedência mínima nem validação de
  transição de estado além da máquina exibida na UI — o servidor aceita
  qualquer status para qualquer agendamento, a restrição de "o que pode
  virar o quê" só existe no código do componente, não na função/tabela.

### Detalhe do agendamento

`src/app/dashboard/appointments/[id]/page.tsx` mostra todos os dados
esperados (cliente com link para o perfil, telefone, serviço + preço,
profissional, observações, status), repete as mesmas ações da lista, e
mostra o formulário de reagendamento **apenas quando o status é `pending`
ou `confirmed`** (bloqueio de estado correto na UI, embora, como já
documentado em `AUDIT-05`, o servidor não repita essa nem outras
validações no `UPDATE`).

## Clientes

Lido `src/app/dashboard/customers/page.tsx` + `customer-row.tsx`:

- Lista todos os clientes da empresa, ordenados por nome.
- Estatísticas reais por cliente, calculadas a partir de todos os
  agendamentos da empresa (não mockadas): quantidade de atendimentos
  concluídos, data do último atendimento concluído, e quantidade de
  agendamentos futuros ainda pendentes/confirmados.
- Cadastro manual de cliente existe (`NewCustomerForm` +
  `createCustomer`), além da criação automática pela página pública —
  ambos os caminhos coexistem.
- CRUD completo: `createCustomer`, `updateCustomer`, `deleteCustomer`
  todos existem em `customers/actions.ts`.
- Não foi verificado nesta auditoria se a página de detalhe/histórico do
  cliente lista individualmente cada agendamento passado (só as
  contagens agregadas na listagem foram lidas em detalhe); como já
  confirmado em auditorias anteriores, o acesso a um cliente de outra
  empresa por ID direto retorna 0 linhas (tenant isolation).

## Serviços

CRUD completo (`createService`, `updateService`, `deleteService`,
`moveService` para reordenar) — reconfirma `AUDIT-03`. **Achado novo
nesta auditoria:**

**`deleteService()` falha silenciosamente quando o serviço tem
agendamentos associados.** A tabela `appointments` tem
`service_id ... references services(id) on delete restrict`
(`schema.sql:232`) — confirmado ao vivo:

```
delete from services where id = '...' and business_id = '...';
ERROR: update or delete on table "services" violates foreign key
constraint "appointments_service_id_fkey" ...
```

Só que `deleteService()` (`services/actions.ts`) executa esse `DELETE`
**sem nunca checar o `error` retornado** — nenhum tratamento, nenhum
fallback, nenhuma mensagem ao usuário. O empresário clica em "Excluir",
confirma no diálogo, e a linha `revalidatePath` roda mesmo assim — o
serviço continua exatamente como estava, sem nenhuma explicação de por
que "não aconteceu nada".

Compare com `deleteProfessional()` (mesmo tipo de restrição, mesma
tabela `appointments`), que **trata esse exato cenário corretamente**:

```ts
if (error) {
  // Likely blocked by existing appointments (ON DELETE RESTRICT).
  await supabase.from("professionals").update({ is_active: false })...
}
```

Ou seja: a mesma situação (exclusão bloqueada por histórico de
agendamentos) tem dois comportamentos diferentes no mesmo produto — uma
entidade cai graciosamente para inativação, a outra falha em silêncio.
Isso não é "proteção contra exclusão perigosa" implementada para
serviços — é ausência de tratamento de erro.

## Profissionais

CRUD completo, com o fallback de soft-delete descrito acima (correto).
Reconfirma achados de `AUDIT-03`: **sem função de reordenar** (ao
contrário de serviços) e **`avatar_url` sem nenhuma UI de upload no
painel**, apesar de ser lido e exibido na página pública. Link para
"visualizar agenda" do profissional individual existe (apontando para
`/dashboard/agenda?professional=<id>`, reaproveitando o filtro da Agenda
em vez de uma tela dedicada separada).

## Permissões (owner/staff)

**Como o produto define os dois papéis (confirmado por RLS +
comentários no SQL):** `services`, `professionals`,
`professional_services`, `business_hours`, `professional_hours`,
`blocked_times`, `customers`, `appointments` são recursos **operacionais**
— a policy de escrita usa `is_business_member()` (qualquer papel,
owner ou staff). Só recursos **administrativos** — `business_members`
(convidar/remover gente), `businesses`/configurações, `themes`, `billing`
— exigem `is_business_owner()`.

**No código da aplicação**, essa mesma divisão é parcialmente reforçada
por `requireOwner(role)`:

| Área | `requireOwner` chamado? |
| --- | --- |
| `plano/actions.ts` | Sim |
| `settings/actions.ts` | Sim |
| `customization/actions.ts` | Sim |
| Serviços/Profissionais/Horários/Bloqueios/Agendamentos/Clientes | Não — correto, são operacionais por design |

**UI condicional por papel:**

| Página | Esconde o formulário de quem não é owner? |
| --- | --- |
| Configurações (`settings/page.tsx`) | Sim (`role === "owner"` antes de renderizar) |
| Plano (`plano/page.tsx`) | Sim, nas ações sensíveis (cancelamento) |
| **Personalização (`customization/page.tsx`)** | **Não** — a página não lê `role` em nenhum momento; o formulário de tema e os uploads de logo/capa aparecem normalmente para qualquer membro. Um usuário staff só descobriria a restrição ao **submeter** o formulário, quando `updateTheme`/`updateBusinessImage` lançam `ForbiddenError` — exceção não tratada por nenhum bloco `try/catch` local, capturada pelo `error.tsx` genérico do segmento `/dashboard` ("Algo deu errado. Não foi possível carregar esta página do painel."), uma mensagem que nem menciona permissão |

**Achado central sobre "staff":** apesar de RLS e parte da aplicação
já estarem preparados para o papel, **não existe nenhuma tela, ação ou
rota no produto para criar um `business_members` com `role = 'staff'`**
(`grep -rln "business_members" src/app` só encontra escrita em
`onboarding/page.tsx`, que cria exclusivamente o primeiro `owner`). A
policy de escrita em `business_members` corretamente exige
`is_business_owner()` (então, se existisse uma tela de convite, só o
dono poderia usá-la) — mas essa tela **não existe**. Na prática, hoje,
**todo negócio criado no produto só pode ter um único usuário: o
próprio proprietário.** A pergunta "staff consegue fazer exatamente o
que deveria e nada além disso" não pôde ser testada por um teste de
produto de ponta a ponta porque staff não pode nem ser criado por essa
via — só foi possível confirmar, lendo RLS + `requireOwner`, o que
*aconteceria* se uma linha `role = 'staff'` existisse (inserida
manualmente no banco): acesso total às áreas operacionais, bloqueio
correto nas 3 áreas administrativas cobertas por `requireOwner`, com a
ressalva de UI da Personalização acima.

## UX

- **Estados vazios:** presentes e com texto útil em agenda (dia),
  agendamentos, clientes, profissionais, serviços, bloqueios,
  notificações e na visão geral (`grep -rl "Nenhum" src/app/dashboard`
  cobre 9 arquivos).
- **Estados de loading:** **não existe nenhum `loading.tsx`** em
  nenhuma rota do `dashboard/` (`find ... -name "loading.tsx"` vazio) —
  não há skeleton/spinner dedicado durante a navegação entre páginas do
  App Router; o usuário só vê a página anterior até o server component
  da próxima resolver.
- **Estados de erro:** existe um `error.tsx` de segmento
  (`dashboard/error.tsx`) com mensagem genérica + botão de tentar
  novamente/voltar — funciona como rede de segurança, mas é genérico
  demais para casos específicos como o de permissão acima.
- **Confirmação em ações destrutivas:** consistente — `ConfirmSubmitButton`
  usado em cancelar/não-compareceu/excluir em todas as telas revisadas.
- **Responsividade/mobile:** não reexecutado nesta auditoria (não há
  navegador disponível neste ambiente); reaproveita o teste visual real
  já feito em `docs/FINAL_QA.md` ("Cenário 6: mobile"), que descreveu o
  menu virando uma barra horizontal rolável em telas pequenas — isso
  bate com o que o código de `layout.tsx` mostra (`<header
  className="... sm:hidden">` com `<DashboardNav orientation="horizontal">`
  dentro de um `overflow-x-auto`).

## Testes executados

1. Leitura completa de `dashboard/page.tsx`, `agenda/page.tsx`,
   `appointments/page.tsx`, `appointments/[id]/page.tsx`,
   `customers/page.tsx`, `services/actions.ts`, `professionals/actions.ts`,
   `nav-links.ts`, `nav.tsx`, `layout.tsx`, `notification-bell.tsx`,
   `auth.ts`.
2. Teste real: `DELETE FROM services WHERE id = ...` (serviço com
   agendamento existente) → `ERROR: ... violates foreign key
   constraint ... appointments_service_id_fkey` — confirma que o app
   ignora esse erro silenciosamente.
3. Grep de `requireOwner` em todo `src/` → só 3 arquivos de ação.
4. Grep de escrita em `business_members` em todo `src/app` → só
   `onboarding/page.tsx`.
5. Leitura da policy RLS de `business_members` e do comentário de design
   em `services` ("staff+owner manage them (operational access)").
6. Busca por `loading.tsx`/`not-found.tsx` em `dashboard/` → nenhum.

## Falhas encontradas

1. `deleteService()` falha silenciosamente quando bloqueado por
   `ON DELETE RESTRICT`, sem mensagem ao usuário — inconsistente com o
   fallback correto de `deleteProfessional()`.
2. "Notificações" não está no menu de navegação, só acessível pelo
   sininho.
3. `customization/page.tsx` não esconde o formulário de quem não é
   owner, ao contrário de `settings`/`plano`; a rejeição só acontece no
   submit, como uma exceção não tratada (tela de erro genérica).
4. Nenhum `loading.tsx` em nenhuma rota do dashboard.

## Requisitos não implementados / não verificáveis no produto

- Convite/criação de usuário staff — não existe em nenhuma tela.
- Reordenação de profissionais (existe só para serviços).
- Upload de foto (`avatar_url`) de profissional pelo painel.
- Teste end-to-end real de "staff consegue fazer X e não Y", porque não
  há como criar uma conta staff pelo produto.

## Recomendações

1. Corrigir `deleteService()` para checar `error` e aplicar o mesmo
   fallback de soft-delete (`is_active = false`) já usado em
   `deleteProfessional()`, ou pelo menos exibir uma mensagem explicando
   por que a exclusão não foi possível.
2. Adicionar "Notificações" ao menu principal, ou documentar
   deliberadamente que o acesso é só pelo sininho.
3. Adicionar a checagem `role === "owner"` em `customization/page.tsx`
   (mesmo padrão de `settings/page.tsx`), e tratar `ForbiddenError` com
   uma mensagem específica em vez de deixar cair no `error.tsx` genérico.
4. Se "staff" for um requisito real do produto, construir a tela de
   convite (`business_members` insert, já protegida corretamente por
   RLS) — hoje o modelo de dados e as regras de acesso estão prontos,
   falta somente a interface.
5. Considerar `loading.tsx` para as rotas com queries mais pesadas
   (agenda, agendamentos, clientes) para evitar a sensação de tela
   travada durante a navegação.
