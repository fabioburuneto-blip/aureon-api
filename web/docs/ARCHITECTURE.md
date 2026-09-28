# Arquitetura

## Visão geral

O produto tem três áreas, todas servidas pelo mesmo app Next.js (App Router):

1. **Site institucional** — `/` — apresentação do produto, login e cadastro.
2. **Dashboard do empresário** — `/dashboard/*` — painel autenticado, sempre
   escopado à empresa do usuário logado.
3. **Página pública de cada negócio** — `/[slug]` — vitrine + agendamento,
   sem autenticação.

```
src/app/
├── page.tsx                 # site institucional
├── login/ signup/           # autenticação (Supabase Auth)
├── auth/confirm/route.ts    # callback de confirmação de email
├── onboarding/               # criação da empresa (primeiro acesso)
├── dashboard/
│   ├── layout.tsx            # resolve a empresa do usuário logado, sidebar
│   ├── page.tsx               # visão geral (métricas do dia, ocupação)
│   ├── agenda/                # calendário dia/semana/mês
│   ├── appointments/          # lista filtrável + [id]/ detalhe e reagendar
│   ├── services/               # CRUD de serviços + reordenar (position)
│   ├── professionals/          # CRUD de profissionais + vínculo com serviços
│   ├── customers/               # lista com histórico resumido + [id]/ detalhe
│   ├── hours/                    # horário de funcionamento (semanal)
│   ├── blocked-times/             # bloqueios/folgas
│   ├── personalizacao/             # identidade, cores, tema, galeria, redes, seções
│   ├── preview/                     # pré-visualização autenticada da página pública
│   ├── notifications/               # histórico de notificações in-app
│   ├── plano/                        # plano atual, status, comparação de planos
│   └── settings/                      # dados da empresa, publicação, notificações
├── api/webhooks/billing/[provider]/   # webhook de cobrança (Mercado Pago/Stripe/Asaas)
├── robots.ts / sitemap.ts             # convenções do App Router para SEO
├── error.tsx / global-error.tsx        # error boundaries (ver "Tratamento de erros")
├── not-found.tsx                       # 404 (também o que /[slug] usa via notFound())
└── [slug]/
    ├── page.tsx               # página pública (dados via RLS pública, cache de 60s)
    └── booking-widget.tsx     # fluxo de agendamento (client component)
```

Suporte compartilhado relevante em `src/lib/`: `auth.ts` (guards),
`logger.ts` (`logError`, log estruturado sem PII — ver
[`DEPLOY.md`](./DEPLOY.md#observabilidade)), `subdomain-routing.ts` (ver
"Subdomínios" abaixo), `supabase/server.ts` (client autenticado, ligado a
cookies) vs. `supabase/public.ts` (client anônimo, sem cookies, usado
pela página pública para poder ser cacheada) vs. `supabase/admin.ts`
(service role, bypassa RLS).

## Por que não há `/[slug]` nas rotas do dashboard

Cada usuário autenticado gerencia **uma** empresa (a modelagem já suporta
múltiplas empresas por usuário via `business_members`, mas o MVP resolve a
"empresa atual" do usuário logado no servidor, em
[`src/lib/auth.ts`](../src/lib/auth.ts) → `getCurrentBusiness()`). Isso
evita expor o id/slug da empresa na URL do dashboard e simplifica todo o
roteamento. Uma futura tela de "trocar de empresa" pode ser adicionada sem
quebrar nada, já que o schema já suporta N:N entre `profiles` e
`businesses` através de `business_members`.

## Camadas de dados

- **Server Components** fazem a maior parte das leituras, usando o cliente
  Supabase server-side (`src/lib/supabase/server.ts`), que propaga a sessão
  via cookies.
- **Server Actions** (`actions.ts` ao lado de cada página) fazem todas as
  escritas autenticadas (dashboard). Elas nunca recebem `business_id` do
  cliente: sempre re-derivam a empresa a partir da sessão
  (`getCurrentBusiness()`), e todo `.eq("business_id", business.id)` é
  redundante de propósito — é defesa em profundidade além do RLS.
- **RPCs Postgres `SECURITY DEFINER`** (`create_business`,
  `get_available_slots`, `create_public_appointment`) cobrem os únicos casos
  em que um visitante anônimo precisa escrever ou ler dados agregados sem
  ter uma linha própria em `business_members`. Veja
  [`DATABASE.md`](./DATABASE.md).
- **Row Level Security** é a fonte de verdade final para isolamento entre
  tenants — veja [`SECURITY.md`](./SECURITY.md).

## Autenticação

Supabase Auth (email + senha, com confirmação por email). O fluxo:

1. `/criar-conta` → `supabase.auth.signUp()` → email de confirmação.
2. Link do email → `/auth/confirm` (Route Handler) → `verifyOtp()` → sessão
   criada → redireciona para `/onboarding`.
3. `/onboarding` é um assistente de 5 passos (negócio → serviços →
   horários → aparência → publicar), resumível a qualquer momento:
   - **Negócio**: nome, segmento, WhatsApp, Instagram e slug (com
     checagem de disponibilidade ao vivo via `is_slug_available()`).
     Ao enviar, a RPC `create_business()` cria a empresa, o vínculo de
     owner, as configurações, o tema padrão e a assinatura trial numa
     única transação.
   - **Serviços**: sugestões pré-preenchidas por segmento
     (`src/lib/onboarding-suggestions.ts`), totalmente editáveis.
   - **Horários**: mesmo formulário/validação de `/dashboard/hours`.
   - **Aparência**: logo, capa e cores reaproveitam os componentes de
     `/dashboard/personalizacao`; descrição é salva à parte.
   - **Publicar**: define `is_published = true` e mostra o link público
     com opção de copiar/visualizar/ir para o painel.
   - O progresso fica em `businesses.onboarding_step` (nunca regride,
     só avança — `greatest_onboarding_step()`), então recarregar a
     página ou voltar mais tarde retoma de onde parou, sem criar uma
     segunda empresa.
4. `src/proxy.ts` (Next.js 16 renomeou `middleware.ts` → `proxy.ts`) mantém
   a sessão viva em toda navegação.

## Página pública e agendamento

A página `/[slug]` só lê dados via as policies públicas do RLS (empresa
publicada, serviços/profissionais ativos, tema, horários). O widget de
agendamento chama diretamente, do navegador, as RPCs públicas
`get_available_slots` e `create_public_appointment` — ambas
`SECURITY DEFINER`, então todo o negócio (validar que o serviço pertence à
empresa do slug, respeitar horários/bloqueios/antecedência mínima, impedir
overbooking) é resolvido no Postgres, nunca confiando em nada que o cliente
tenha enviado além do slug + ids escolhidos na UI.

## Motor de página pública (temas e seções)

`/[slug]` não é mais um layout fixo: é um pipeline
`PublicPageRenderer → ThemeProvider → SectionRenderer → {HeroSection,
AboutSection, ServicesSection, TeamSection, GallerySection, BookingSection,
LocationSection, SocialSection, FooterSection}`, em
[`src/app/[slug]/renderer/`](../src/app/[slug]/renderer/). O mesmo
`PublicPageRenderer` é usado, sem duplicar nenhum HTML, por `/[slug]/page.tsx`
(visitante real) e por `/dashboard/preview` (dono autenticado) — os dois só
diferem em como buscam os dados (`getBusinessPageData()` público vs.
`getCurrentBusiness()`) e se passam `previewMode`.

- **Temas**: `themes.preset` (`premium`/`moderno`/`minimalista`/`barbearia`/
  `elegante`) seleciona um conjunto de tokens em
  [`src/lib/theme-presets.ts`](../src/lib/theme-presets.ts) — fonte
  (`font-serif`/`font-sans`, só famílias do sistema já embutidas no
  Tailwind, nenhuma fonte é buscada de fora), peso/tracking do título,
  raio de borda, estilo de card/botão, densidade e composição do hero
  (`overlay`/`split`/`centered`/`bold`/`soft`). Cada seção lê esses tokens
  em vez de ter estilo fixo — é um sistema de tokens compartilhado, não 5
  páginas paralelas. `primary_color`/`secondary_color` continuam por
  empresa, aplicados como CSS custom properties (`--brand-primary`/
  `--brand-secondary`) pelo `ThemeProvider`.
- **Seções**: `themes.sections` (jsonb) guarda a ordem e visibilidade das 9
  seções. [`src/lib/sections.ts`](../src/lib/sections.ts) é a única fonte
  de verdade de quais seções existem; `normalizeSectionsConfig()` nunca
  confia no formato armazenado — revalida, preenche o que faltar e sempre
  fixa `hero` primeiro, `footer` por último e `booking` visível,
  independente do que está salvo. É chamada tanto antes de salvar
  (`/dashboard/personalizacao`) quanto na renderização (defesa em
  profundidade).
- **Galeria**: `business_gallery` (nova tabela) guarda fotos extras,
  reaproveitando o bucket `business-assets` e as policies de storage já
  existentes (path `{business_id}/...`) — sem nenhuma migration de storage
  nova.
- **Agendamento**: a seção `BookingSection` só embrulha o `BookingWidget`
  existente — nenhuma lógica de disponibilidade/criação de agendamento foi
  duplicada ou alterada. `/dashboard/preview` passa `previewMode`, que faz
  o formulário nunca chamar `create_public_appointment` (mostra a tela de
  "confirmado" sem nenhuma escrita real).

## Subdomínios

O produto tem três públicos claramente diferentes, hoje todos servidos por
um único domínio (como neste repositório): o site institucional (`/`), o
produto autenticado (`/dashboard`, `/login`, `/criar-conta`, `/onboarding`,
`/auth/confirm`) e as páginas públicas de agendamento de cada empresa
(`/{slug}`). A arquitetura já está preparada para separá-los em três
subdomínios da plataforma:

- `app.seusite.com` — produto autenticado
- `agenda.seusite.com/{slug}` — páginas públicas de agendamento
- `www.seusite.com` (ou o apex) — site institucional

Isto é separação de domínios **da plataforma**, não domínio customizado
por cliente/tenant — nenhuma empresa tem ou terá (ainda) um domínio
próprio; todas continuam vivendo em `agenda.seusite.com/{slug}`.

A ativação é opcional e não muda nada até ser configurada: `src/proxy.ts`
lê três variáveis de ambiente opcionais (`NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_AGENDA_URL`, `NEXT_PUBLIC_MARKETING_URL`) via
`getSubdomainConfig()` em `src/lib/subdomain-routing.ts`. Enquanto menos
de duas delas apontarem para hosts distintos (o caso padrão — nenhuma
configurada), essa função retorna `null` e o middleware não redireciona
nada, exatamente o comportamento de hoje. Assim que duas ou mais
estiverem configuradas, `resolveSubdomainRedirect()` (função pura,
testada em `subdomain-routing.test.ts`) decide, por host + path, para
onde redirecionar: uma rota do produto acessada em `agenda.*` ou `www.*`
vai para `app.*`; um slug de empresa acessado em `app.*` ou `www.*` vai
para `agenda.*`; a raiz acessada fora de `www.*` vai para lá. `/api/*`
nunca é redirecionado — um provedor de webhook bate numa URL fixa, e
redirecionar essa chamada tende a quebrar a entrega, não ajudar. Passo a
passo de DNS/Vercel para ativar: [`DEPLOY.md`](./DEPLOY.md#4-domínio).

## Tratamento de erros

Três limites de erro (`error.tsx` da App Router, ver
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`
para a convenção exata desta versão — ela usa a prop `retry`, não
`reset`): `src/app/error.tsx` cobre tudo sob o layout raiz (site
institucional, auth, página pública), `src/app/dashboard/error.tsx`
isola uma falha de renderização a uma única página do painel sem derrubar
o resto do app, e `src/app/global-error.tsx` é o último recurso (falha no
próprio layout raiz) — só ele define `<html>`/`<body>` próprios, já que
substitui o layout raiz inteiro quando ativo. `src/app/not-found.tsx` é o
404 global, reaproveitado por `notFound()` em `/[slug]` quando o slug não
existe ou a empresa está despublicada.

## Multi-tenant, hoje e amanhã

- Hoje: 1 owner + N staff por empresa (`business_members.role`).
- Preparado para amanhã: um mesmo `user_id` pode pertencer a múltiplas
  empresas (a unique constraint é `(business_id, user_id)`, não
  `(user_id)`), e novos papéis (`gerente`, `administrador`) só exigem
  estender o `check` de `role` e as policies que hoje distinguem apenas
  `owner`/`staff`.
