# ETAPA 1 — Onboarding simples, rápido e completo

## RESUMO

Substituído o formulário único de onboarding (nome/slug/segmento) por um
assistente de 5 passos resumível: **Negócio → Serviços → Horários →
Aparência → Publicar**. Nenhuma proteção de segurança das etapas P0 foi
tocada ou enfraquecida — a matriz de isolamento multi-tenant e a
validação central de agendamento (`validate_appointment_slot`) continuam
exatamente como estavam. A rota `/signup` foi renomeada para
`/criar-conta` em todo o código e na documentação operacional.

## O QUE FOI IMPLEMENTADO

### Passo 1 — Negócio
Nome, segmento, WhatsApp (opcional), Instagram (opcional, aceita
`@handle` ou URL completa — normalizado para o handle puro) e slug com
**verificação de disponibilidade ao vivo** (debounce de 400ms chamando a
nova RPC `is_slug_available()`), além da validação de formato já
existente no cliente (`isValidSlug`). Ao enviar, `create_business()`
(estendida com `p_whatsapp`/`p_instagram`) cria a empresa, o vínculo de
owner, `business_settings`, `themes` e a assinatura trial numa única
transação, exatamente como antes.

### Passo 2 — Serviços
Lista pré-preenchida com sugestões por segmento
(`src/lib/onboarding-suggestions.ts` — 7 dos 8 segmentos têm sugestões
reais; "Outro" fica vazio de propósito). Cada item é editável (nome,
duração, preço) e removível; é possível adicionar mais. Nenhum serviço é
obrigatório — uma lista vazia é aceita e o dono pode adicionar depois
pelo painel.

### Passo 3 — Horários
Reaproveita `saveBusinessHours()` (a mesma função que
`/dashboard/hours` usa) através de um novo wrapper
(`saveOnboardingHours`) que só adiciona o avanço de passo — a lógica de
validação/upsert não foi duplicada.

### Passo 4 — Aparência
Reaproveita `ImageUploader` e `ThemeForm` **exatamente como já existiam**
em `/dashboard/customization` (mesmos componentes, mesmas actions —
`updateBusinessImage`/`updateTheme` não foram tocadas). Só a descrição
tem uma action nova e pequena, específica deste passo.

### Passo 5 — Publicar
Define `is_published = true`, mostra a URL pública com botão de copiar,
link para "Visualizar página" (abre `/[slug]` de verdade, sem
reimplementar preview) e "Ir para o painel".

### Resumabilidade
`businesses.onboarding_step` (nova coluna, 1-5) rastreia o passo mais
avançado já alcançado. `greatest_onboarding_step()` (nova RPC,
`SECURITY DEFINER`, reverifica `is_business_member()` internamente)
garante que voltar para revisar um passo anterior **nunca regride** o
progresso salvo. Um refresh de página ou um acesso posterior a
`/onboarding` retoma exatamente daquele ponto — nunca cria uma segunda
empresa, porque a página raiz do assistente decide o passo a partir de
`business_members` + `onboarding_step`, nunca a partir de estado do
navegador.

### Slug
Sugestão automática a partir do nome (já existia), normalização
(`slugify`, já existia), formato inválido bloqueado no cliente
(`isValidSlug`, já existia — só ganhou `criar-conta` na lista de
reservados), disponibilidade em tempo real (`is_slug_available()`, novo)
e duplicidade impedida no servidor pela constraint `unique(slug)` +
`create_business()` (já existia, comportamento não alterado).

### Segurança
`owner_id`/`business_id` nunca são recebidos do navegador como
autoridade — toda action deriva o negócio da sessão via
`getCurrentBusiness()` (já existente) ou, no passo 1 (antes de a sessão
ter uma empresa), do próprio `auth.uid()` dentro de `create_business()`.
`greatest_onboarding_step()` e `reschedule_appointment()` (da etapa P0)
seguem o mesmo padrão: toda escrita `SECURITY DEFINER` reverifica
pertencimento por conta própria, nunca confiando em RLS sozinha.

### Rota `/criar-conta`
`src/app/signup/` renomeado para `src/app/criar-conta/` (`git mv`,
histórico preservado). Todas as referências internas atualizadas:
`robots.ts`, `page.tsx` (CTAs da home), `login/page.tsx`, `error.tsx`
(comentário), `subdomain-routing.ts` (prefixo de rota autenticada).
Documentação operacional (`README.md`, `docs/SETUP.md`,
`docs/DEPLOY.md`, `docs/ARCHITECTURE.md`) também atualizada — os
documentos de auditoria em `docs/audit/*` e `docs/FINAL_QA.md`/
`docs/AUDIT.md` foram deixados intocados por serem registro histórico
do que era verdade no momento em que cada um foi escrito.

## O QUE NÃO FOI IMPLEMENTADO NESTA ETAPA (fora de escopo, documentado)

- **Múltiplos intervalos de horário no mesmo dia** (ex.: manhã +
  tarde com intervalo de almoço). O schema atual de `business_hours`
  tem `unique(business_id, day_of_week)` — só permite um intervalo por
  dia. Suportar múltiplos intervalos exigiria uma mudança de schema que
  também afeta `/dashboard/hours` (fora deste passo) e
  `get_available_slots()`/`validate_appointment_slot()` (o motor de
  disponibilidade da etapa P0). Não implementado agora para não misturar
  uma mudança estrutural maior dentro do escopo desta etapa.
- **Motor de temas/seções completo** (5 temas nomeados, galeria,
  localização) — é explicitamente a Etapa 2 do plano maior; o passo 4
  desta etapa só reaproveita o que já existe (2 cores + layout
  clássico/minimalista).

## TESTES CRIADOS

**SQL, permanentes** (`supabase/tests/db.sql`, nova seção "ONBOARDING
WIZARD"): `is_slug_available` (disponível, reservado, formato inválido,
já em uso), `create_business()` armazenando whatsapp/instagram
corretamente, `onboarding_step` começando em 1, **slug duplicado
rejeitado sem criar empresa nem membership duplicados**,
`greatest_onboarding_step` avançando e **nunca regredindo**, bloqueado
para quem não é membro, e reconfirmação de que o grant de
`authenticated` em `businesses` expõe as 3 colunas novas mas continua
sem expor `owner_id`/`phone`/`email` para não-membros.

Confirmado explicitamente que essas 13 novas asserções **falham** contra
uma cópia do banco com só as migrations anteriores a esta etapa (erro
`function is_slug_available(unknown) does not exist`) e **passam**
integralmente com a migration desta etapa aplicada — mesmo padrão de
verificação usado na etapa P0.

**TypeScript, permanentes** (Vitest): `slug.test.ts` (novo caso:
`criar-conta` reservado), `validations.test.ts` (5 novos casos:
whatsapp/instagram opcionais, normalização de `@handle` e de URL
completa do Instagram, whatsapp preservado como digitado),
`onboarding-suggestions.test.ts` (novo arquivo: toda segmento tem
entrada, barbearia sugere exatamente Corte/Barba/Corte + Barba, toda
sugestão tem duração/preço positivos, "Outro" fica vazio de propósito).

**Total: 146/146 testes passando** (137 pré-existentes + 9 novos, zero
alterados, zero removidos).

## O QUE FOI TESTADO DE VERDADE VS. O QUE NÃO FOI

- **Toda a lógica de banco** (RPCs, RLS, constraint de slug único,
  resumabilidade) foi testada com SQL real contra um Postgres 16
  descartável com as migrations reais aplicadas — não presumida.
- **Rotas e guarda de autenticação**: testado com um servidor Next.js
  real (`next dev`) e requisições reais — `/onboarding` sem sessão
  redireciona para `/login` (HTTP 307), `/criar-conta` responde 200,
  `/signup` responde 404. `/criar-conta` também verificado visualmente
  num navegador real (Chromium via Playwright, screenshot capturado) e
  os dois CTAs da home confirmados apontando para `/criar-conta`.
- **O assistente de 5 passos em si (autenticado) não foi clicado de
  ponta a ponta num navegador real.** Este ambiente não tem acesso a um
  backend de Auth real (GoTrue) nem a Docker Hub/GHCR para subir o stack
  completo do Supabase local — a mesma limitação já documentada em
  `docs/FINAL_QA.md` e `docs/audit/FINAL-AUDIT.md` para todo o resto do
  produto autenticado. `next build` compila e gera a rota `/onboarding`
  sem erro, o `tsc --noEmit` valida toda a árvore de componentes, e cada
  ação de servidor foi verificada isoladamente contra o Postgres real
  (mesma consulta, mesmos parâmetros que o componente cliente envia) —
  mas o clique real em cada botão do assistente, passo a passo, não foi
  observado num navegador.

## VALIDAÇÃO FINAL

```
npm run lint       → limpo
npm run typecheck  → limpo
npm test           → 146/146 (137 pré-existentes + 9 novos)
npm run build      → build de produção concluído, rota /criar-conta
                      gerada, /signup removida, 22 rotas no total
```

`supabase/tests/db.sql` — suíte completa (pré-existente + P0 + Etapa 1)
— `ALL ASSERTIONS PASSED` contra uma aplicação limpa das 12 migrations,
confirmado duas vezes em bancos descartáveis distintos.
