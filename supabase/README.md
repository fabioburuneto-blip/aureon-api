# Banco de dados — SaaS de barbearias (Supabase)

Estrutura multi-tenant: um único código atende todas as barbearias e cada uma é
isolada por `barbearia_id` com RLS. Fuso horário: **America/Sao_Paulo**. Moeda: **BRL**.

## Como aplicar

Com a Supabase CLI (projeto já linkado):

```bash
supabase db push
```

Ou cole os arquivos de `supabase/migrations/` **em ordem** no SQL Editor do painel.

| Arquivo | Conteúdo |
|---|---|
| `…0100_estrutura.sql` | tabelas, constraints, triggers, seed do catálogo |
| `…0200_seguranca_rls.sql` | funções auxiliares, RLS e grants |
| `…0300_funcoes_publicas.sql` | RPCs `barbearia_publica`, `horarios_livres`, `criar_agendamento_publico` |
| `…0400_storage.sql` | bucket público `barbearias` e suas políticas |
| `…0500_dias_disponiveis.sql` | RPC `dias_disponiveis` (calendário de 30 dias do agendamento) |

### Dados de exemplo

`supabase/seed.sql` cria a barbearia fictícia **Navalha & Co.** em 4 versões (`demo`,
`demo-classico`, `demo-urbano`, `demo-minimalista`), com serviços, equipe e agenda. Cole o arquivo no
SQL Editor (ou use `supabase db reset` localmente). Ele é idempotente: recria as demos a cada execução.

### Primeiro superadmin

Crie o usuário em *Authentication → Users* e depois, no SQL Editor:

```sql
insert into public.perfis (id, nome, papel)
values ('<uuid do auth.users>', 'Seu nome', 'superadmin');
```

Donos e barbeiros são criados da mesma forma (com `barbearia_id`), pelo superadmin
ou pelo backend com a `service_role`.

## Regras importantes

- **Papéis**: `superadmin` vê e edita tudo. `dono` e `barbeiro` leem e editam só os
  registros da própria barbearia. Um usuário sem perfil não vê nada.
- **Perfis**: cada um edita o próprio perfil e o dono edita os da equipe. `papel` e
  `barbearia_id` só mudam pelo superadmin; só ele liga ou desliga uma barbearia (`ativo`).
- **Isolamento**: as FKs compostas `(id, barbearia_id)` impedem, por exemplo, criar um
  agendamento na barbearia A com um profissional, serviço ou cliente da barbearia B.
- **Público (anon)**: lê barbearias ativas (só as colunas `id, slug, nome, whatsapp,
  endereco, cidade, instagram, horario_funcionamento, tema`), além de serviços e
  profissionais ativos e o catálogo. Liste as colunas no `select`, porque `select('*')` na
  tabela `barbearias` como anon retorna erro. Não tem acesso a agendamentos, clientes,
  bloqueios nem disponibilidade.
- **Site público**: prefira `rpc('barbearia_publica', { p_slug })`. Uma chamada traz a
  barbearia, o tema, os serviços e os profissionais, e funciona mesmo se quem abrir o
  site estiver logado em outra barbearia.
- **Tema**: chaves ausentes são completadas com o padrão (layout `luxo`, fundo escuro,
  destaque dourado). Valores inválidos (layout, par de fontes, cor fora de `#hex`) são
  rejeitados.
- **dia_semana**: 0 = domingo … 6 = sábado. Um profissional pode ter vários intervalos
  no mesmo dia (ex.: pausa para almoço).
- **Bloqueios** com `profissional_id` nulo bloqueiam a barbearia inteira.
- **Agendamentos**: se `fim` ou `preco_cobrado` não forem informados, são preenchidos a
  partir do serviço. A exclusion constraint `agendamentos_sem_sobreposicao` impede
  sobreposição para o mesmo profissional, e os cancelados não contam.
- **Excluir serviço, profissional ou cliente com histórico** é bloqueado. Nesses casos,
  use `ativo = false`.
- **Telefone** é salvo só com dígitos (10 a 13), e o cliente é único por barbearia e telefone.

## RPCs

```js
// horários livres (profissional opcional: null = qualquer um)
supabase.rpc('horarios_livres', {
  p_slug: 'barbearia-do-ze', p_servico_id, p_profissional_id: null, p_data: '2026-09-24'
})
// → [{ inicio, fim, hora: '09:30', profissionais: [uuid, ...] }, ...]

supabase.rpc('criar_agendamento_publico', {
  p_slug, p_servico_id, p_profissional_id: null, p_inicio: '2026-09-24T09:30:00-03:00',
  p_nome_cliente: 'Maria', p_telefone: '(11) 91234-5678'
})
// → { ok: true, agendamento: { id, data, hora, preco, moeda: 'BRL', ... },
//     barbearia, servico, profissional, cliente }
// → { ok: false, codigo: 'horario_indisponivel', mensagem: 'Poxa, esse horário acabou de ser ocupado...' }
```

```js
// dias com vaga nos próximos 30 dias (mesmas regras de horarios_livres)
supabase.rpc('dias_disponiveis', { p_slug, p_servico_id, p_profissional_id: null, p_dias: 30 })
// → [{ data: '2026-09-24', horarios: 38 }, { data: '2026-09-27', horarios: 0 }, ...]
```

Códigos de erro de `criar_agendamento_publico`: `nome_invalido`, `telefone_invalido`,
`barbearia_nao_encontrada`, `servico_nao_encontrado`, `profissional_nao_encontrado`,
`horario_passado`, `horario_indisponivel`, `limite_agendamentos`.

- Os horários seguem uma grade de 15 minutos a partir de cada `hora_inicio` da
  disponibilidade, e o serviço precisa caber inteiro antes de `hora_fim`.
- Sem profissional escolhido, o agendamento vai para quem está livre e tem menos
  atendimentos no dia (em caso de empate, vale a `ordem`).
- Um cliente já existente (mesmo telefone) é reaproveitado, e o nome cadastrado não é
  sobrescrito.
- Anti-abuso: no máximo 3 agendamentos futuros confirmados por telefone
  (`v_max_futuros` na função).

## Storage

Bucket público `barbearias` (imagens de até 5 MB). O caminho **precisa** começar pelo
id da barbearia:

```
<barbearia_id>/logo.png
<barbearia_id>/galeria/foto-01.jpg
```

Qualquer pessoa lê pela URL pública. Só a equipe da barbearia (ou o superadmin) envia,
substitui ou remove arquivos da própria pasta.
