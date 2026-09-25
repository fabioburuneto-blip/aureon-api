# AUDIT-04 — Página Pública e Personalização

Auditoria read-only. Nenhum código foi alterado. Achados de segurança
testados contra um Postgres 16 descartável com as migrations reais
aplicadas (nunca produção).

## Resultado

**FAIL** em relação ao motor de páginas públicas especificado — o
mecanismo que existe é uma página única e fixa por empresa, não um
motor de temas/seções configurável. **PASS** em tudo relacionado a
segurança de dados públicos e SEO, que estão corretos dentro do escopo
menor que de fato existe.

## Temas

**Não existem os 5 temas nomeados (Premium, Moderno, Minimalista,
Barbearia, Elegante).** `grep -rln "Premium\|Moderno\|Minimalista\|
Barbearia\|Elegante" src/` só encontra a palavra "Barbearia" como texto
livre (nome de empresa de exemplo em algum lugar), nunca como um tema
selecionável. A personalização visual real, definida na tabela `themes`
(`supabase/migrations/20250924120002_schema.sql:261-269`) e no
formulário `src/app/dashboard/customization/theme-form.tsx`, é:

- `primary_color` e `secondary_color`: dois seletores de cor livre
  (`<input type="color">`), não uma paleta pré-definida por tema.
- `layout`: um `<select>` com exatamente 2 opções — `"classic"`
  ("Clássico") e `"minimal"` ("Minimalista")
  (`theme-form.tsx:44-47`).

Isso não corresponde a "5 temas que diferem em tipografia, espaçamento,
cards, botões, composição" — há uma única composição de página fixa
(ver seção "Seções" abaixo); o que muda entre `classic`/`minimal` **não
foi encontrado sendo lido em lugar nenhum de `src/app/[slug]/page.tsx`**
(`grep -n "layout" "src/app/[slug]/page.tsx"` não retorna nenhuma
ocorrência) — ou seja, mesmo a única distinção de 2 valores que existe
no banco **não tem efeito visual comprovado na página pública** dentro
do código lido.

## Seções

A página pública inteira é **um único componente fixo**,
`src/app/[slug]/page.tsx` (313 linhas), sem nenhuma componentização por
seção, sem registro de seções, sem controle de ordem ou visibilidade.
Comparando contra as 9 seções pedidas:

| # | Seção esperada | Existe? | Observação |
| --- | --- | --- | --- |
| 1 | Hero | Parcial | Faixa de capa (`cover_url` como background) + logo + nome + segmento, linhas 156-196 — sem título/CTA de hero de verdade |
| 2 | Sobre | Parcial | Só um parágrafo com `business.description`, sem título de seção próprio, condicionado a existir descrição (linha 198-200) |
| 3 | Serviços | Sim | Lista com nome/duração/preço (linhas 237-267) |
| 4 | Equipe | Parcial | Lista de profissionais com foto/inicial + nome (linhas 204-234), chamada "Profissionais", sem bio nem outros detalhes |
| 5 | Galeria | **Não existe** | Não há campo de galeria no schema (`businesses` só tem `logo_url`/`cover_url`, duas imagens únicas, não um array) nem seção correspondente |
| 6 | Agendamento | Sim | O `BookingWidget`, na coluna lateral (linha 293-302) |
| 7 | Localização | **Não existe** | `businesses` não tem coluna de endereço/cidade/mapa; nada a exibir |
| 8 | Redes sociais | **Não existe** | Nenhuma coluna de Instagram/redes sociais no schema; nada a exibir |
| 9 | Rodapé | Sim, mínimo | "Agenda por Aureon Agenda", linha 306-310 — não é customizável pelo empresário |

**4 das 9 seções pedidas simplesmente não têm dado nenhum para exibir**,
porque os campos que as alimentariam não existem no schema.

## Personalização

O que o empresário consegue de fato alterar (verificado em
`dashboard/settings/actions.ts` e `dashboard/customization/actions.ts`,
contra as colunas reais de `businesses`/`themes`):

| Campo pedido | Existe? |
| --- | --- |
| Logo | Sim (`logo_url`, upload real via Storage) |
| Imagem de capa | Sim (`cover_url`, idem) |
| Galeria | **Não** |
| Nome | Sim |
| Descrição | Sim |
| WhatsApp | **Não** (só `phone` genérico, não rotulado como WhatsApp) |
| Instagram | **Não** |
| Endereço | **Não** |
| Tema | Parcial — só 2 cores + 1 seletor `classic`/`minimal` sem efeito comprovado, ver "Temas" |
| Cores | Sim, 2 cores livres |
| Visibilidade das seções | **Não** — não há seções configuráveis |
| Ordem das seções | **Não** — idem |

## Preview

**A rota `/dashboard/preview` não existe.** `find src/app/dashboard -type
d -iname "preview"` não retorna nada, e nenhum arquivo do repositório
contém uma rota com esse nome. Não há, portanto:

- Exigência de autenticação para preview (não aplicável — não existe).
- Reuso dos componentes da página pública num contexto autenticado (não
  aplicável).
- Garantia de que preview não cria agendamento real (não aplicável —
  mas vale registrar que a própria página pública real, quando acessada
  pelo próprio dono logado em outra aba, se comporta normalmente e
  criaria um agendamento real like qualquer visitante, já que
  `create_public_appointment()` não distingue quem está chamando).

## Slugs

Testado contra banco real:

| Caso | Resultado |
| --- | --- |
| Slug válido, empresa publicada | Retorna os dados (1 linha) |
| Slug inexistente | 0 linhas — a página chama `notFound()`, confirmado também via navegador real numa sessão de QA anterior (`docs/FINAL_QA.md`, HTTP 404 real) |
| Slug duplicado (na criação) | Rejeitado por `unique(slug)` — ver `AUDIT-02` |
| Empresa desativada (`is_published = false`) | 0 linhas para `anon` — **o mesmo efeito exato de slug inexistente**, testado ativamente (alternando `is_published` e reconsultando) |
| Caracteres especiais | A própria constraint do banco (`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`) impede que um slug assim exista; qualquer URL com caracteres fora desse padrão simplesmente não casa com nenhuma linha e cai no mesmo 404 |
| Slug alterado | Não há campo de edição de slug em nenhum formulário do dashboard (`grep -rln "slug" src/app/dashboard/settings` não encontra um input de slug) — uma vez criado, o endereço público não pode ser trocado pela UI |

## Dados públicos — verificação de vazamento

Testado ativamente, não apenas lido:

- `select * from businesses` como `anon` → **`ERROR: permission denied
  for table businesses`** (a query inteira falha, não retorna um
  subconjunto).
- `select id, name, owner_id from businesses` como `anon` → **mesmo
  erro** — basta `owner_id` aparecer em qualquer lugar da consulta para
  ela falhar inteira; não há forma de "vazar por engano" essa coluna
  nem com uma query manual direta contra a REST API.
- Colunas realmente liberadas para `anon`
  (`supabase/migrations/20250924120009_audit_hardening.sql:24-27`):
  `id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at`. **Nunca** `owner_id`, `phone`,
  `email`.
- `business_settings` (que teria `booking_window_days`,
  `min_notice_minutes` etc.) **não tem nenhuma policy de leitura
  pública** — confirmado por leitura de
  `20250924120004_rls.sql` — a página pública não lê essa tabela
  diretamente (comentário explícito no código,
  `[slug]/page.tsx:91-93`, dizendo que a janela real é aplicada dentro
  das funções `SECURITY DEFINER`).
- `customers`, `appointments`, `notifications`,
  `notification_deliveries`, `subscriptions`, `billing_webhook_events`:
  nenhuma tem policy de leitura para `anon` (confirmado em
  `AUDIT-01-FOUNDATION.md`, mapa de entidades).
- Nenhum token/secret é passado para o cliente da página pública: a
  página usa `src/lib/supabase/public.ts`, que só carrega
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a chave pública documentada como
  segura para expor, protegida pelo RLS/grants acima, não por sigilo).

**Conclusão de segurança: nenhum dado administrativo, financeiro ou de
cliente vaza para o visitante da página pública.**

## SEO

Verificado em `src/app/[slug]/page.tsx:104-134` (`generateMetadata`),
`src/app/robots.ts` e `src/app/sitemap.ts` — os três arquivos existem
(diferente do que uma leitura só do nome sugeriria checar; confirmados
por conteúdo, não só presença):

- `title`: nome da empresa.
- `description`: descrição da empresa, ou uma frase padrão se vazia.
- `alternates.canonical`: `/{slug}`.
- OpenGraph: `title`, `description`, `url`, `type: "website"`, `images`
  (capa da empresa, se houver).
- Twitter Card: `summary_large_image`, mesmos dados.
- Página inexistente/despublicada: `robots: { index: false, follow:
  false }` em vez de metadata vazia — impede indexação de uma página
  que vai retornar 404.
- `src/app/robots.ts`: libera `/` e as páginas de slug, bloqueia
  `/dashboard`, `/api`, `/login`, `/signup`, `/onboarding`; aponta para
  o sitemap.
- `src/app/sitemap.ts`: lista a home e toda empresa com
  `is_published = true`, com `lastModified` a partir de `updated_at`.

Nenhum problema de SEO encontrado dentro do que existe.

## Multi-tenant (página pública)

Reconfirma o que já foi testado em `AUDIT-01`: cada slug só retorna os
dados da própria empresa (`eq("business_id", business.id)` em toda
subconsulta de `getBusinessPageData()`), e o teste real feito na sessão
de QA anterior (`docs/FINAL_QA.md`, "Cenário 5") confirmou visualmente
duas empresas publicadas simultaneamente sem nenhuma mistura de
serviços, tema ou profissionais.

## Testes executados

Contra Postgres real (nunca produção):

1. `select *` e `select ..., owner_id` de `businesses` como `anon` →
   ambos `permission denied`.
2. Slug inexistente → 0 linhas.
3. Empresa despublicada (`is_published = false`) → 0 linhas para
   `anon`, mesmo efeito de slug inexistente.
4. Leitura completa de `src/app/[slug]/page.tsx` (313 linhas),
   `theme-form.tsx`, `customization/actions.ts`, `settings/actions.ts`,
   schema de `businesses`/`themes`.
5. Busca por `Premium|Moderno|Minimalista|Barbearia|Elegante` como
   nomes de tema, por `dashboard/preview`, por coluna de
   Instagram/endereço/galeria — todas vazias.

## Problemas encontrados

Todos já detalhados acima; resumo:

1. Nenhum dos 5 temas nomeados existe.
2. O único seletor de layout (`classic`/`minimal`) não tem efeito
   visível comprovado na página pública.
3. 4 das 9 seções esperadas não têm campo de dado nenhum no schema
   (Galeria, Localização, Redes sociais; "Sobre" existe mas sem
   identidade de seção própria).
4. `/dashboard/preview` não existe.
5. WhatsApp/Instagram/endereço não são coletáveis em lugar nenhum do
   produto.
6. Slug não pode ser editado após a criação (pode ser intencional, mas
   não há nem uma mensagem explicando isso ao usuário).

## Recomendações

1. Mesma recomendação central do `AUDIT-01`: decidir com quem definiu o
   escopo se o motor de temas/seções é um requisito real pendente — o
   trabalho para construí-lo (schema novo para galeria/endereço/redes
   sociais, um sistema de seções configurável, os 5 temas de fato
   diferenciados visualmente) é comparável a reconstruir a página
   pública do zero, não um ajuste incremental sobre o que existe.
2. Se o layout `classic`/`minimal` for para ficar, implementar de fato
   a diferença visual entre os dois na renderização — hoje o campo
   existe e é salvo, mas não parece influenciar nada.
3. Se edição de slug for desejada, adicionar o campo (com o mesmo
   cuidado de unicidade/reservados já usado na criação); se não for
   desejada por design, considerar uma nota explicativa na tela de
   configurações.
4. Adicionar campos de WhatsApp/Instagram/endereço ao schema e à tela
   de configurações se forem, de fato, requisito — hoje não têm onde
   morar no banco.
