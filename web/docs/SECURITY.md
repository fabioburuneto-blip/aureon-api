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

### RLS filtra linhas, não colunas

RLS decide **quais linhas** de `businesses` o `anon` pode ler (apenas
empresas publicadas), não quais colunas dessa linha. Uma policy de leitura
pública em `businesses`, sozinha, deixaria `owner_id`/`phone`/`email`
igualmente legíveis por qualquer visitante que consultasse a API REST do
PostgREST diretamente (`...&select=owner_id,phone,email`), mesmo que
nenhuma página do app jamais renderize esses campos — a cautela da UI não
é reforçada em lugar nenhum a nível de banco.

Por isso, além da RLS, `businesses` tem um **`GRANT` de coluna** restrito
para `anon` (`supabase/migrations/20250924120009_audit_hardening.sql`):

```sql
revoke select on public.businesses from anon;
grant select (
  id, name, slug, segment, description, timezone,
  logo_url, cover_url, is_published, created_at, updated_at
) on public.businesses to anon;
```

`owner_id`, `phone` e `email` nunca chegam a `anon`, no banco, independente
de qualquer query que a aplicação escreva. `authenticated` mantém acesso
total às colunas da própria empresa (via RLS de linha, para o dashboard).

Consequência prática: `select *` falha (não apenas filtra) para um role
com grant só em algumas colunas — todo código que lê `businesses` como
`anon` (a página pública `/[slug]`) precisa listar as colunas
explicitamente, nunca usar `select("*")`.

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
- `SUPABASE_SERVICE_ROLE_KEY` (em `.env.example`) ignora RLS e **nunca** é
  lida por código que roda no navegador. Ela é usada, deliberadamente, em
  exatamente três pontos server-only — todos marcados `"server-only"` ou
  dentro de Server Actions/Route Handlers, nunca em Client Components
  (`grep "use client"` confirma zero referências a `process.env` em
  qualquer arquivo `"use client"`):
  - `src/lib/supabase/admin.ts` — o único lugar que cria o client com essa
    chave; importa `"server-only"` no topo para causar erro de build caso
    algum dia seja importado por um Client Component.
  - `src/app/api/webhooks/billing/[provider]/route.ts` — o provedor de
    pagamento (fora do Supabase Auth) não tem uma sessão de usuário para
    autenticar a escrita em `subscriptions`; o Route Handler valida a
    assinatura do webhook e usa o client admin para aplicar a mudança.
  - `src/app/dashboard/plano/actions.ts` e
    `src/lib/billing/providers/local.ts` — o modo de billing local (sem
    provedor configurado, ver [`BILLING.md`](./BILLING.md)) simula essa
    mesma escrita de assinatura para desenvolvimento.
  Nenhum desses pontos confia em `business_id` vindo do cliente sem antes
  resolver a empresa via `getCurrentBusiness()` ou validar o evento do
  webhook — o bypass de RLS não é bypass de autorização.
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
tabelas. O bucket também aplica `file_size_limit` (5MB) e
`allowed_mime_types` (`image/jpeg`, `image/png`, `image/webp`,
`image/gif`) do lado do Storage — a checagem que o `ImageUploader` já
fazia no cliente era só UX, trivialmente contornável chamando a API de
Storage diretamente com a chave `anon`.

## Auditoria

Ver [`AUDIT.md`](./AUDIT.md) para o registro da auditoria de segurança e
correção mais recente: o que foi verificado, o que foi corrigido e quais
riscos residuais foram conscientemente deixados como recomendação (não
como bug) por exigirem decisão de produto ou funcionalidade nova.
