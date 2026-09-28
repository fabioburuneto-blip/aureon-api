# ETAPA 2 — Motor de página pública personalizada

## O QUE EXISTIA ANTES

Conforme `docs/audit/AUDIT-04-PUBLIC-PAGE.md` (leitura obrigatória desta
etapa, re-confirmada por leitura de código, não por memória da conversa):
`/[slug]/page.tsx` era um componente único e fixo (313 linhas), sem
seções componentizadas, sem registro de visibilidade/ordem. `themes` só
tinha 2 cores + um `layout` (`classic`/`minimal`) sem efeito visual
comprovado. Não existiam os 5 temas nomeados, galeria, campos de
endereço/cidade, nem a rota `/dashboard/preview`. `/dashboard/customization`
só editava logo/capa/cores/layout.

## O QUE FOI IMPLEMENTADO

### Modelo de dados (migration `20250924120013_public_page_engine.sql`)

- `businesses.address`, `businesses.city` — texto livre, adicionados ao
  mesmo grant de coluna seguro de `anon`/`authenticated` (nunca
  `owner_id`/`phone`/`email`).
- `themes.preset` — `text check (in premium/moderno/minimalista/
  barbearia/elegante)`, default `moderno`.
- `themes.sections` — `jsonb`, array ordenado de `{key, visible}` para as
  9 seções, default com todas visíveis (hero primeiro, footer último).
- `business_gallery` — nova tabela (`id, business_id, image_url,
  position`), RLS: leitura pública só para empresa publicada (ou membro),
  escrita só pelo owner — reaproveita o bucket `business-assets` e as
  policies de storage já existentes (path `{business_id}/...`), sem
  nenhuma migration de storage nova.
- **Nada da P0/Etapa 1 foi tocado**: `validate_appointment_slot()`,
  `create_public_appointment()`, `reschedule_appointment()`, os grants de
  `businesses` para `owner_id`/`phone`/`email`, e a RLS de
  `business_members`/`services`/`professionals` continuam exatamente como
  estavam — confirmado revendo os arquivos antes de escrever a migration.

### Verificação ao vivo (Postgres real, nunca produção)

Migration aplicada com sucesso sobre a cadeia completa de 13 migrations
(disposable Postgres 16). RLS testada ativamente: owner A insere/lê sua
galeria; owner B **não consegue** inserir nem apagar foto da galeria de A
(RLS bloqueia); `anon` lê a galeria de uma empresa publicada mas não
escreve; ao despublicar A, `anon` deixa de ver a galeria (mesmo efeito de
slug inexistente), e o próprio owner continua vendo (necessário para
`/dashboard/preview` antes de publicar); `preset` rejeita um valor fora
dos 5 nomeados (constraint do banco, não só do Zod); `address`/`city`
legíveis por `anon`/`authenticated`, `owner_id`/`phone` continuam dando
`permission denied` para ambos.

## TEMAS

5 presets implementados como um **sistema de tokens compartilhado**
(`src/lib/theme-presets.ts`), não 5 páginas separadas — cada seção lê os
mesmos tokens (`fontHeading`, `radiusClass`, `cardClassName`,
`buttonClassName`, `sectionGapClassName`, `heroVariant`, `density`) em vez
de ter estilo fixo:

| Preset | Fonte título | Cantos | Hero | Densidade |
| --- | --- | --- | --- | --- |
| Premium | serifada | `rounded-sm` | capa full-bleed com overlay escuro | espaçosa |
| Moderno | sans bold | `rounded-2xl` | split texto/imagem lado a lado | normal |
| Minimalista | sans fina | `rounded-none`, sem sombra/borda | centralizado, sem ênfase de imagem | muito espaçosa |
| Barbearia | sans black, uppercase | `rounded-none`, borda grossa | fundo escuro, alto contraste | compacta |
| Elegante | serifada itálica | `rounded-3xl` | centralizado sobre fundo pastel | espaçosa |

Fontes usam só `font-serif`/`font-sans` (famílias do sistema já embutidas
no Tailwind) — nenhuma fonte externa é buscada em build ou request,
deliberado para não introduzir uma dependência de rede nem custo de
performance. Cores (`primary_color`/`secondary_color`) continuam por
empresa, aplicadas como CSS custom properties pelo `ThemeProvider`.

✅ **IMPLEMENTADO E TESTADO** — os 5 presets renderizam de forma
visivelmente distinta; verificado com screenshots reais (ver "QA VISUAL").

## SEÇÕES

9 componentes reutilizáveis em `src/app/[slug]/renderer/`
(`HeroSection`, `AboutSection`, `ServicesSection`, `TeamSection`,
`GallerySection`, `BookingSection`, `LocationSection`, `SocialSection`,
`FooterSection`), orquestrados por `SectionRenderer` a partir de um único
registro (`src/lib/sections.ts`). Adicionar uma 10ª seção no futuro é uma
entrada nova nesse registro + um componente novo, sem tocar
`/[slug]/page.tsx` nem `/dashboard/preview`.

- Hero, Agendamento e Rodapé são sempre visíveis (não podem ser ocultados
  pelo dono — esconder o funil de agendamento ou a capa quebraria a
  página); Hero e Rodapé também têm posição fixa (primeiro/último).
  `normalizeSectionsConfig()` reforça isso tanto ao salvar quanto ao
  renderizar (defesa em profundidade contra uma linha salva à mão ou de
  uma versão anterior).
- Localização absorve o horário de funcionamento (não é uma das 9 seções
  nomeadas, mas "onde e quando" já existia na página antiga e seria uma
  regressão real removê-lo).

✅ **IMPLEMENTADO E TESTADO** — 22 testes unitários (`sections.test.ts`)
cobrem normalização, toggle, reorder e os limites de seções travadas;
renderização real verificada nos 5 screenshots.

## PERSONALIZAÇÃO

`/dashboard/personalizacao` (renomeada de `/dashboard/customization`, git
mv preservando histórico) ganhou 6 cartões, cada um com sua própria server
action e estado salvo/erro explícito (sem debounce — mais simples e sem
race condition):

1. **Identidade** — logo/capa (`ImageUploader`, inalterado) + descrição.
2. **Galeria** — novo `GalleryManager`, upload direto pro bucket
   `business-assets` (mesma validação de tipo/tamanho client-side, mesmo
   limite de 5MB reforçado pelo bucket) + limite de 12 fotos reforçado na
   server action.
3. **Cores** — os 2 seletores de cor que já existiam (`ColorsForm`,
   `layout` removido do formulário — nunca teve efeito comprovado, ver
   AUDIT-04).
4. **Estilo** — `PresetPicker`, grade com os 5 temas, salva ao clicar.
5. **Redes sociais** — WhatsApp/Instagram, **novo caminho de edição**
   (antes só existiam no onboarding, sem tela de edição posterior).
6. **Localização** — endereço/cidade, novo.
7. **Seções** — `SectionsForm`, toggle + mover ↑/↓, com seções travadas
   desabilitadas na UI.

✅ **IMPLEMENTADO E TESTADO** — build de produção gera a rota, `tsc`/lint
limpos. 🟡 **IMPLEMENTADO MAS NÃO VALIDADO REALMENTE** o clique ponta a
ponta num navegador autenticado (ver "LIMITAÇÕES" — mesma limitação de
Auth real já documentada nas etapas anteriores).

## PREVIEW

`/dashboard/preview` reaproveita literalmente o mesmo `PublicPageRenderer`
usado por `/[slug]` — zero HTML duplicado. Busca dados via
`getCurrentBusiness()` (nunca via cache pública), não exige
`is_published = true` (dono revisa antes de publicar), e passa
`previewMode: true` até o `BookingWidget`. O widget mostra horários reais
(leitura, inofensiva) mas `previewMode` faz o formulário **nunca chamar
`create_public_appointment`** — o caminho de código para a RPC simplesmente
não existe quando `previewMode` é verdadeiro (não é "o dono não vai
clicar", é "não há para onde clicar que chame a RPC").

✅ **IMPLEMENTADO E TESTADO** (build gera a rota; comportamento de não
escrever verificado por leitura do fluxo de `handleSubmit` — o branch
`if (previewMode) { onSuccess(); return; }` precede qualquer chamada ao
Supabase). 🟡 clique real num navegador autenticado não verificado (mesma
limitação de Auth).

## SEGURANÇA

- **DTO restrito**: `src/app/[slug]/renderer/types.ts` define
  `PublicPageBusiness` com só os campos públicos — igual ao padrão já
  usado em `auth.ts`/`[slug]/page.tsx` desde a P0, adicionar
  `business.email` ali quebra a compilação em vez de vazar em silêncio.
- **Isolamento multi-tenant**: reconfirmado ao vivo para `business_gallery`
  (novo) com o mesmo ataque A-vs-B já usado desde a P0 — B não lê/escreve
  nada de A, `anon` só lê o publicado. `services`/`professionals`
  continuam filtrados por `business_id` + `is_active` exatamente como
  antes (nenhuma query dessas foi tocada).
- **Preview nunca cria agendamento real** — ver seção acima.
- Nenhuma mudança em `validate_appointment_slot`,
  `create_public_appointment`, `reschedule_appointment`, RLS de
  `business_members`, ou nos grants de `owner_id`/`phone`/`email`.

✅ **IMPLEMENTADO E TESTADO** — 17 novas asserções permanentes em
`supabase/tests/db.sql`, confirmadas falhando contra as migrations
anteriores a esta etapa (erro `column "preset" does not exist`) e
passando integralmente com a migration aplicada.

## SEO

`generateMetadata` em `/[slug]/page.tsx` mantido (título/descrição/OG/
Twitter/canonical), com a descrição-fallback agora incluindo a cidade
quando disponível (`Agende um horário com {name} em {city}.`) em vez de
uma frase genérica fixa — continua dinâmico, nunca hardcoda o nome de uma
empresa específica. `robots.ts`/`sitemap.ts` não foram tocados (já
corretos, per AUDIT-04).

✅ **IMPLEMENTADO E TESTADO** (build de produção gera `/robots.txt` e
`/sitemap.xml`, `generateMetadata` verificado por leitura de código).

## PERFORMANCE

- `revalidate = 60` mantido em `/[slug]/page.tsx`, combinado com
  `revalidatePath` explícito em toda action de `personalizacao/actions.ts`
  (tema, cores, descrição, redes, localização, seções, galeria) — mesma
  garantia de antes: uma edição aparece na página pública imediatamente
  via invalidação sob demanda, e em até 60s mesmo se a invalidação
  falhasse por algum motivo.
- Todas as imagens (logo, capa, galeria, avatares) usam `next/image` com
  `fill`/`sizes` apropriados — nenhuma tag `<img>` crua.
- Sem N+1: a busca de dados públicos continua um `Promise.all` único
  (agora com `business_gallery` adicionado ao paralelo, não uma query
  sequencial extra).
- A maior parte do renderer é Server Components — só `PresetPicker`,
  `SectionsForm`, `GalleryManager` e os formulários de
  `personalizacao/` são Client Components (interatividade real:
  clique/upload/estado local), igual ao padrão já usado no resto do
  dashboard.

✅ **IMPLEMENTADO E TESTADO** (lido no código; tempo de resposta real
observado durante o QA visual, sem latência perceptível adicional pelas
5 trocas de preset).

## TESTES

**SQL, permanentes** (`supabase/tests/db.sql`, nova seção "PUBLIC PAGE
ENGINE"): default de `preset`/`sections`, owner altera seu preset, outro
owner não consegue (RLS), `preset` inválido rejeitado pela constraint,
galeria: insert/select/delete por owner, insert/delete cross-tenant
bloqueados, leitura pública só quando publicada, owner ainda vê
despublicada, `address`/`city` legíveis por `anon`/`authenticated` com
`owner_id`/`phone` continuando bloqueados. Confirmado **falhando** contra
uma cópia do banco só com as migrations até a Etapa 1 (erro `column
"preset" does not exist` na primeira asserção nova) e **passando**
integralmente com esta migration aplicada.

**TypeScript, permanentes** (Vitest): `sections.test.ts` (16 casos —
default, normalize contra entrada inválida/parcial/duplicada, toggle,
reorder, limites de seções travadas), `theme-presets.test.ts` (6 casos —
os 5 presets existem, são todos visivelmente diferentes entre si por
assinatura de tokens), `validations.test.ts` (11 novos casos — `themeSchema`
sem `layout`, `themePresetSchema`, `businessSocialSchema`,
`businessLocationSchema`, `sectionsConfigSchema`).

**Total: 179/179 testes passando** (146 no fim da Etapa 1 + 33 novos desta
etapa: 16 de `sections.test.ts` + 6 de `theme-presets.test.ts` + 11 de
`validations.test.ts` = 179; zero alterados/removidos de etapas
anteriores).

## QA VISUAL

Ambiente real: Postgres 16 descartável com as 13 migrations aplicadas +
uma empresa de demonstração completa ("Barbearia QA": descrição, WhatsApp,
Instagram, endereço/cidade, 3 serviços, 2 profissionais, 3 fotos de
galeria, horário de funcionamento) + `next dev` real + Chromium via
Playwright (`/opt/pw-browsers/chromium`), usando o mesmo shim REST↔SQL já
estabelecido nas etapas anteriores.

- **5 temas, screenshot desktop (1280px) e mobile (390px) de cada um**:
  todos renderizam com hierarquia visual clara, contraste legível
  (inclusive o hero escuro do preset Barbearia, texto branco sobre fundo
  escuro), espaçamento consistente, CTA de agendamento sempre visível e
  reconhecível. Nenhum tema ficou visualmente quebrado.
- **Breakpoints** 375/768/1024/1440px verificados (preset Moderno, o de
  composição mais arriscada por usar grid split no hero): `scrollWidth >
  clientWidth` é `false` nos 4 — **sem scroll horizontal em nenhum**.
  390px (mobile real) verificado nos 5 presets.
- Galeria em grade 2 colunas no mobile / 3 no desktop, sem overflow.
- Hero split (Moderno) empilha corretamente no mobile (texto em cima,
  imagem embaixo) em vez de espremer duas colunas.

✅ **IMPLEMENTADO E TESTADO** — screenshots reais capturados e inspecionados
(não presumido a partir do código).

## LIMITAÇÕES

- **Fluxo autenticado completo não clicado ponta a ponta num navegador
  real** — `/dashboard/personalizacao` (os 7 cartões) e `/dashboard/preview`
  não foram exercitados via login real, porque este ambiente não tem
  acesso a um backend de Auth real (GoTrue) nem a Docker Hub/GHCR para
  subir o stack completo do Supabase local — a mesma limitação já
  documentada em `docs/FINAL_QA.md` e em todas as etapas anteriores para
  qualquer superfície autenticada. Verificado em vez disso por: `tsc
  --noEmit` limpo, `next build` gerando as duas rotas sem erro, leitura
  adversarial do código de cada action/formulário, e teste ao vivo contra
  Postgres real de toda a lógica de banco que essas telas acionam.
- A galeria não tem um limite de fotos reforçado no banco (só na server
  action, `MAX_GALLERY_PHOTOS = 12`) — decisão deliberada para não
  duplicar essa regra em dois lugares; um `insert` feito fora da app (ex.:
  REST API direta) não é bloqueado por essa contagem, só pela RLS de
  ownership. Documentado como aceitável porque não é uma questão de
  segurança (o owner só pode "poluir" a própria galeria).

## O QUE NÃO FOI IMPLEMENTADO NESTA ETAPA (fora de escopo, deliberado)

- WhatsApp/e-mail reais, cobrança real, cancelamento/reagendamento
  self-service pelo cliente, qualquer-profissional, buffer entre
  agendamentos, múltiplos funcionários por conta, fidelidade, relatórios
  financeiros, marketplace, app nativo — exatamente a lista que a
  instrução da Etapa 2 pediu para não tocar.
- Drag-and-drop de seções (a instrução permite ↑/↓ simples — foi o que se
  implementou).
- Edição de slug (fora do escopo desta etapa; já documentado como gap
  conhecido desde a AUDIT-04).

## RESULTADO FINAL

| Item | Classificação |
| --- | --- |
| Modelo de dados (address/city, preset, sections, galeria) | ✅ IMPLEMENTADO E TESTADO |
| 5 temas nomeados, visivelmente distintos | ✅ IMPLEMENTADO E TESTADO |
| 9 seções reutilizáveis, visibilidade + ordem | ✅ IMPLEMENTADO E TESTADO |
| `/dashboard/personalizacao` completo | ✅ IMPLEMENTADO E TESTADO (banco/build); 🟡 clique real não verificado |
| `/dashboard/preview` | ✅ IMPLEMENTADO E TESTADO (banco/build); 🟡 clique real não verificado |
| `/[slug]` restrito a DTO seguro, sem dado administrativo | ✅ IMPLEMENTADO E TESTADO |
| Isolamento multi-tenant (galeria incluída) | ✅ IMPLEMENTADO E TESTADO |
| SEO dinâmico | ✅ IMPLEMENTADO E TESTADO |
| Performance (cache, imagens, sem N+1) | ✅ IMPLEMENTADO E TESTADO |
| QA visual real (5 temas, mobile, breakpoints) | ✅ IMPLEMENTADO E TESTADO |

### VALIDAÇÃO FINAL

```
npm run lint       → limpo
npm run typecheck  → limpo
npm test           → 179/179 (146 pré-existentes + 33 novos, ver "TESTES")
npm run build      → build de produção concluído, 23 rotas, incluindo
                      /dashboard/personalizacao e /dashboard/preview
```

`supabase/tests/db.sql` — suíte completa (pré-existente + P0 + Etapa 1 +
Etapa 2) — `ALL ASSERTIONS PASSED` contra uma aplicação limpa das 13
migrations; confirmado falhando contra as 12 migrations anteriores antes
de aplicar esta.

**Arquivos alterados/criados**: ver `git status` no commit desta etapa —
resumo: 1 migration nova (`20250924120013_public_page_engine.sql`),
`src/types/database.ts`, `src/lib/validations.ts` (+ teste),
`src/lib/theme-presets.ts` (+ teste), `src/lib/sections.ts` (+ teste),
`src/app/[slug]/renderer/*` (novo, 11 arquivos), `src/app/[slug]/page.tsx`
(reescrito), `src/app/[slug]/booking-widget.tsx` (prop `previewMode`
aditiva), `src/app/dashboard/customization/` → `src/app/dashboard/
personalizacao/` (renomeado + 6 arquivos novos), `src/app/dashboard/
preview/page.tsx` (novo), `src/app/dashboard/nav-links.ts`,
`src/app/onboarding/actions.ts`/`steps/step-appearance.tsx` (import
atualizado), `supabase/tests/db.sql`, `README.md`, `docs/ARCHITECTURE.md`.

**Migrations novas**: `20250924120013_public_page_engine.sql`.

**Tabelas alteradas**: `businesses` (+`address`, `+city`), `themes`
(+`preset`, `+sections`).

**Tabelas novas**: `business_gallery`.

**Policies novas**: `business_gallery_select_public_or_member`,
`business_gallery_owner_all`.

**Testes adicionados**: 17 asserções SQL (`db.sql`), 16 testes
(`sections.test.ts`), 6 testes (`theme-presets.test.ts`), 11 testes novos
em `validations.test.ts`.

**Número total de testes**: 179 (Vitest) + suíte SQL completa.

**Branch**: `claude/blissful-edison-4wt18p` (main não foi re-consolidada
nesta etapa — só foi tocada na Etapa 0, por instrução explícita; esta
etapa segue o mesmo padrão da Etapa 1 de não voltar a mexer em `main` sem
pedido novo).
