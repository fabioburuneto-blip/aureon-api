# Segurança e multi-tenancy

## Princípio

Este é um SaaS multi-tenant: cada empresa é um tenant isolado. A separação
é garantida **no banco de dados via Row Level Security**, não apenas no
frontend ou nas queries da aplicação. Mesmo que um bug no código do
dashboard tentasse ler/escrever a empresa errada, o Postgres recusaria.

## Row Level Security

RLS está habilitado em **todas** as tabelas de `public`
(`supabase/migrations/20250924120004_rls.sql`). O padrão usado:

- Tabelas administrativas (`businesses` update/delete, `business_settings`,
  `business_members`, `themes` update, `subscriptions`) só são graváveis
  pelo **owner** (`is_business_owner(business_id)`).
- Tabelas operacionais (`services`, `professionals`,
  `professional_services`, `business_hours`, `professional_hours`,
  `blocked_times`, `customers`, `appointments`) são graváveis por qualquer
  **membro** da empresa, owner ou staff (`is_business_member(business_id)`)
  — reflete "staff tem acesso operacional controlado, owner administra a
  empresa".
- Leitura pública (sem autenticação) é permitida apenas para o que compõe a
  página pública de uma empresa **publicada**: `businesses` (colunas não
  sensíveis), `services`/`professionals` ativos, `business_hours`, `themes`.
- `customers`, `appointments`, `blocked_times`, `business_settings`,
  `professional_hours` **nunca** são legíveis por `anon`. O visitante
  anônimo só interage com esses dados indiretamente, através das funções
  `SECURITY DEFINER` descritas em [`DATABASE.md`](./DATABASE.md), que
  devolvem apenas o necessário (ex: horários livres, nunca a lista de
  agendamentos).

`is_business_member()`/`is_business_owner()` são `SECURITY DEFINER` para
evitar recursão de RLS ao consultar `business_members` dentro de suas
próprias policies.

## Proteção contra IDOR e manipulação de `business_id`

Nenhum server action ou RPC confia em um `business_id` enviado pelo
cliente:

- No dashboard, `src/lib/auth.ts` → `getCurrentBusiness()` resolve a
  empresa **a partir da sessão autenticada**, consultando
  `business_members` pelo `user_id` do token — nunca a partir de um campo
  de formulário. Todo server action usa esse `business.id` resolvido no
  servidor, e ainda assim inclui `.eq("business_id", business.id)`
  explicitamente nas queries (defesa em profundidade, redundante com o
  RLS de propósito).
- Na página pública, `create_public_appointment()` recebe um **slug**, não
  um id, e resolve `business_id` internamente; `service_id`/
  `professional_id` enviados pelo cliente são revalidados contra esse
  `business_id` resolvido antes de qualquer escrita.
- `create_business()` usa `auth.uid()` do lado do banco para definir o
  `owner_id` — o cliente não pode criar uma empresa em nome de outro
  usuário.

## Segredos

- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` são seguros
  para expor ao navegador — a segurança vem do RLS, não do sigilo dessas
  chaves.
- `SUPABASE_SERVICE_ROLE_KEY` (em `.env.example`) **nunca** deve ser usada
  no código do app (ela ignora RLS). Não há nenhum uso dela neste
  repositório; está documentada apenas para scripts administrativos que
  você rodar fora do app.
- Nenhuma credencial é commitada — `.env*` está no `.gitignore`.

## Senhas

Gerenciadas inteiramente pelo Supabase Auth (`supabase.auth.signUp` /
`signInWithPassword`); a aplicação nunca armazena ou manipula senhas.

## Validação de entrada

Todo formulário e server action valida com Zod
(`src/lib/validations.ts`) antes de tocar o banco. As funções Postgres
`SECURITY DEFINER` fazem sua própria validação novamente do lado do banco
(formato de slug, segmento válido, antecedência mínima, janela máxima de
agendamento) — a validação no cliente é conveniência de UX, não a
garantia de segurança.

## Prevenção de overbooking sob concorrência

Ver [`DATABASE.md`](./DATABASE.md#prevenção-de-overbooking) — um
`EXCLUDE` constraint no Postgres, não apenas uma checagem "SELECT antes de
INSERT" na aplicação (que teria uma race condition).

## Storage

O bucket `business-assets` é público para leitura (necessário para exibir
logo/capa na página pública), mas escrita/atualização/remoção de um objeto
só é permitida ao owner da empresa dona daquele caminho
(`{business_id}/...`), via a mesma função `is_business_owner()` usada nas
tabelas.
