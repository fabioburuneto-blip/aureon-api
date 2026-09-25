# AUDIT-02 — Autenticação e Onboarding

Auditoria read-only. Nenhum código foi alterado. Testes de banco rodados
contra um Postgres 16 descartável com as migrations reais aplicadas
(nunca produção) — nunca contra um Supabase real, pelas mesmas
limitações de ambiente descritas em `docs/FINAL_QA.md`.

## Resultado

**FAIL** em relação ao roteiro de onboarding especificado no comando.

O fluxo de autenticação em si (cadastro, login, logout, sessão,
confirmação de e-mail, proteção de rotas) está implementado
corretamente e passou em todo teste de segurança realizado. O
onboarding, porém, **não é o wizard de 9 passos especificado** — é um
formulário de uma página só, com 3 campos. Como o próprio comando pede
para verificar "os 9 passos" e o resultado é "não existem", o veredito
geral deste documento é FAIL, mesmo com o Auth em si em ótimo estado.

## Fluxo encontrado

```
/signup (cadastro: nome, e-mail, senha)
  -> supabase.auth.signUp() com emailRedirectTo = /auth/confirm
  -> e-mail de confirmação enviado pelo Supabase Auth
/auth/confirm?token_hash=...&type=... (Route Handler, GET)
  -> supabase.auth.verifyOtp()
  -> redirect para "next" (padrão: /onboarding)
/onboarding (SE o usuário ainda não tem business_members -- senão redireciona para /dashboard)
  -> um único formulário: nome da empresa, slug (auto-gerado do nome,
     editável), segmento
  -> RPC create_business()
  -> redirect para /dashboard/services?welcome=1
```

Não existe recuperação de senha (`resetPasswordForEmail` ou equivalente
não aparece em nenhum lugar do código — `grep` vazio).

## Requisitos atendidos

- **Cadastro** (`src/app/signup/actions.ts`): valida nome/e-mail/senha
  com Zod (senha mínimo 6 caracteres), chama
  `supabase.auth.signUp()` com `emailRedirectTo` apontando para
  `/auth/confirm`. Trata especificamente erro de e-mail já cadastrado
  com mensagem em português.
- **Confirmação de e-mail** (`src/app/auth/confirm/route.ts`): Route
  Handler real (`GET`), usa `verifyOtp()` com `token_hash`/`type` da
  URL — não é um placeholder. Em caso de erro, redireciona para
  `/login` com mensagem de link inválido/expirado, nunca deixa a
  requisição pendurada.
- **Login** (`src/app/login/actions.ts`): valida com Zod, chama
  `signInWithPassword()`, mensagem genérica "Email ou senha incorretos"
  em caso de erro (não vaza qual dos dois está errado — correto do
  ponto de vista de enumeração de usuários).
- **Logout** (`src/app/auth/actions.ts`): `signOut()` real seguido de
  redirect para `/login`.
- **Sessão**: `src/lib/supabase/proxy.ts` roda em toda requisição (via
  `src/proxy.ts`, matcher exclui só assets estáticos) e chama
  `supabase.auth.getUser()` a cada request — isso é o que mantém o
  token de sessão renovado entre navegações, documentado no próprio
  código como intencional ("Do not remove").
- **Proteção de rotas**: não é feita no middleware — é feita por
  `requireUser()`/`getCurrentBusiness()`
  (`src/lib/auth.ts:15-26, 81-122`), chamadas em `dashboard/layout.tsx`
  e em toda página que precisa. Middleware só cuida de manter a sessão
  viva; a decisão de redirecionar mora nas próprias páginas — verificado
  por leitura direta de `src/proxy.ts` e `src/lib/supabase/proxy.ts`.
- **Comportamento de sessão expirada**: como `getUser()` sempre
  revalida contra o Supabase (nunca confia só no JWT local decodificado
  — é a orientação oficial do Supabase SSR), uma sessão expirada sem
  refresh token válido resulta em `user = null`, e `requireUser()`
  redireciona para `/login` (`src/lib/auth.ts:21-23`).
- **Redirecionamentos**: `/dashboard` sem sessão -> `/login`;
  `/onboarding` sem sessão -> `/login`; `/onboarding` com empresa já
  criada -> `/dashboard`; `/dashboard` sem empresa -> `/onboarding`.
  Todos confirmados por leitura de código (ver tabela de roteamento
  abaixo) e, no caso do primeiro, também confirmado na sessão de QA
  anterior contra o app rodando de verdade (307 real, `docs/FINAL_QA.md`
  "Cenário 7").
- **Criação da empresa é segura**: `create_business()`
  (`20250924120008_billing.sql:87`, versão final) usa `auth.uid()`
  internamente para `owner_id` — a assinatura da função
  (`p_name, p_slug, p_segment, p_timezone`) não tem parâmetro de
  `owner_id`/`user_id` em lugar nenhum; **não há como o cliente escolher
  outro dono**. A função também levanta `authentication required` se
  `auth.uid()` for nulo (linha ~100-102 da função).
- **Slug automático, disponibilidade e duplicata**: `slugify()`
  (`src/lib/slug.ts:18`) gera o slug a partir do nome digitado, editável
  manualmente depois. Testado em banco real (script desta auditoria):
  slug reservado (`dashboard`) é rejeitado com `slug is reserved`; slug
  duplicado é rejeitado pela `unique` constraint
  (`businesses_slug_key`), capturado no app por `error.code === "23505"`
  em `onboarding/actions.ts:41-42` e mostrado como "Esse endereço já
  está em uso. Escolha outro." — nunca o erro cru do Postgres.
- **Validações**: nome (mín. 2 caracteres), slug (regex
  `^[a-z0-9]+(-[a-z0-9]+)*$`, 3-60 caracteres, fora da lista de
  reservados), segmento (enum fechado) — validados tanto no Zod
  (`createBusinessSchema`, `src/lib/validations.ts:27-36`) quanto de
  novo dentro da própria função Postgres (defesa em profundidade real,
  não só no cliente).

## Requisitos parcialmente atendidos

- **Roteamento contra acesso a empresa de terceiros**: não existe
  literalmente porque nenhuma rota do dashboard carrega um
  `business_id`/slug na URL (a empresa é sempre resolvida da sessão via
  `getCurrentBusiness()`). Isso fecha esse vetor específico por
  construção, mas as duas rotas que TÊM um `[id]` na URL
  (`/dashboard/appointments/[id]`, `/dashboard/customers/[id]`) foram
  testadas ativamente nesta auditoria: um dono de uma empresa A,
  fornecendo o `id` de um agendamento/cliente real pertencente a uma
  empresa B, recebe 0 linhas na consulta exata que a página usa
  (`.eq("id", id).eq("business_id", business.id)`), o que dispara
  `notFound()` — confirmado com dados reais, não só lido no código.

## Requisitos ausentes

- **Wizard de 9 passos** (nome, segmento, WhatsApp, Instagram,
  cidade/endereço, slug, tema, serviços, horários) — **não existe**.
  `src/app/onboarding/onboarding-form.tsx` é um único `<form>` com 3
  campos (nome, slug, segmento). Não há WhatsApp, Instagram,
  cidade/endereço, seleção de tema, cadastro de serviço nem de horário
  dentro do onboarding — essas 4 telas existem, mas **depois**, dentro
  do dashboard normal (`/dashboard/services`,
  `/dashboard/professionals`, `/dashboard/hours`,
  `/dashboard/customization`), não como parte de um fluxo guiado de
  primeiro acesso.
- **Barra de progresso** — não existe (não há progresso a mostrar, é uma
  página só).
- **Botão "voltar" entre passos** — não existe, pela mesma razão.
- **Persistência de progresso entre passos / comportamento ao
  atualizar a página** — não aplicável: não há estado de passo a
  persistir. Atualizar a página limpa os 3 campos preenchidos (como
  qualquer formulário HTML comum sem "salvar rascunho"), mas como é um
  preenchimento de ~15 segundos isso tem impacto de UX pequeno,
  diferente do que teria num wizard de 9 passos real.
- **Comportamento ao voltar no navegador** — idem: sem passos, não há
  o que teria de comportamento especial além do padrão do navegador.
- **Campos WhatsApp/Instagram/cidade-endereço no cadastro da empresa**
  — não existem em `createBusinessSchema` nem na tabela `businesses`
  como campos de onboarding dedicados. (`businesses` tem `phone`/`email`
  genéricos, editáveis depois em `/dashboard/settings`, mas não
  coletados no onboarding, e não há campo de Instagram ou
  cidade/endereço em lugar nenhum do schema.)
- **Seleção de tema durante o onboarding** — não existe (nem o próprio
  tema tem as 5 opções nomeadas esperadas — ver `AUDIT-04`).
- **Recuperação de senha** — não encontrada em nenhum lugar do código.

## Falhas de segurança

Nenhuma encontrada nesta camada. Todos os testes de segurança abaixo
foram executados ativamente (não apenas inferidos da leitura):

| Teste | Resultado |
| --- | --- |
| Criar empresa com `owner_id` de outro usuário | Impossível — função não aceita esse parâmetro |
| Criar empresa sem sessão (`auth.uid()` nulo) | Rejeitado (`authentication required`) |
| Slug reservado (`dashboard`) | Rejeitado |
| Slug duplicado | Rejeitado pela constraint única |
| Ler agendamento de outra empresa via `/dashboard/appointments/[id]` | 0 linhas — `notFound()` |
| Ler cliente de outra empresa via `/dashboard/customers/[id]` | 0 linhas — `notFound()` |
| `/dashboard` sem sessão | Redireciona para `/login` |
| `/onboarding` com empresa já criada | Redireciona para `/dashboard` |

## Problemas de UX

- Nenhum problema de UX identificado dentro do que **existe** (o
  formulário de 1 página funciona, valida bem, mostra erro claro). O
  problema de UX real é de escopo: o roteiro original promete uma
  experiência guiada de 9 passos coletando bem mais informação da
  empresa antes do primeiro acesso ao painel, e o que existe entrega a
  empresa "pronta" (nome+slug+segmento) e deixa todo o resto
  (WhatsApp, tema, serviços, horários) para o usuário descobrir sozinho
  dentro do dashboard depois — mitigado parcialmente pelo aviso descrito
  abaixo.
- O redirect final (`/dashboard/services?welcome=1`) **é lido e usado de
  verdade**: `src/app/dashboard/services/page.tsx:7-9,26-31` lê
  `searchParams.welcome` e, quando presente, mostra o aviso "Empresa
  criada! Cadastre pelo menos um serviço e um profissional para publicar
  sua agenda." — uma correção da primeira leitura desta auditoria, que
  havia classificado esse parâmetro como não utilizado sem checar o
  arquivo de destino; verificado por leitura direta antes de publicar
  este relatório. Não é um wizard, mas é uma orientação real de próximo
  passo, não um parâmetro morto.

## Evidências

| Achado | Arquivo | Linhas |
| --- | --- | --- |
| Cadastro | `src/app/signup/actions.ts` | 14-49 |
| Confirmação de e-mail | `src/app/auth/confirm/route.ts` | 6-25 |
| Login | `src/app/login/actions.ts` | 14-35 |
| Logout | `src/app/auth/actions.ts` | 6-10 |
| Guardas de rota | `src/lib/auth.ts` | 15-26, 81-122 |
| Middleware (só refresh de sessão) | `src/proxy.ts`, `src/lib/supabase/proxy.ts` | inteiro |
| Onboarding (formulário único) | `src/app/onboarding/onboarding-form.tsx` | 1-87 |
| Onboarding (server action) | `src/app/onboarding/actions.ts` | 9-48 |
| `create_business()` (versão final) | `supabase/migrations/20250924120008_billing.sql` | 87-146 |
| Slug: normalização e reservados | `src/lib/slug.ts` | 1-36 |
| `welcome=1` lido e usado (aviso pós-onboarding) | `src/app/dashboard/services/page.tsx` | 7-9, 26-31 |

## Testes realizados

Contra Postgres real (migrations aplicadas, nunca produção):

1. `create_business()` com slug reservado → `ERROR: slug is reserved`
2. `create_business()` com slug já usado → `ERROR: duplicate key value
   violates unique constraint "businesses_slug_key"`
3. `create_business()` com slug de formato inválido → `ERROR: invalid
   slug format`
4. Dono de empresa A lendo `appointments`/`customers` de empresa B pela
   consulta exata das páginas `[id]` → 0 linhas nos dois casos
5. Leitura de código completa de todo o fluxo de auth (7 arquivos) e do
   onboarding (2 arquivos + validações)

`npm run lint` / `typecheck` / `test` / `build` — ver `AUDIT-01-
FOUNDATION.md` (mesma execução vale para os 4 relatórios, não repetida
aqui).

## Recomendações

1. **Decisão de produto urgente**: confirmar se o wizard de 9 passos é
   um requisito real a construir ainda, ou se o formulário de 1 página
   atual é a direção aceita — o gap entre os dois é grande demais para
   ser tratado como polimento.
2. Se o wizard de 9 passos for confirmado como requisito, ele precisa
   de: schema novo para WhatsApp/Instagram/endereço no onboarding (hoje
   só existe `phone`/`email` genéricos em `businesses`), componente de
   barra de progresso, e uma decisão sobre onde o estado entre passos
   fica (cliente com `useState` local é suficiente se for tudo uma
   única `page.tsx`; se for multi-rota, precisa de persistência real).
3. Remover ou implementar de fato o uso de `?welcome=1` — hoje é um
   parâmetro morto que engana quem lê o código achando que há uma
   lógica de boas-vindas.
4. Se recuperação de senha for um requisito, ela não existe hoje e
   precisa ser adicionada (`supabase.auth.resetPasswordForEmail()` +
   uma página de nova senha).
