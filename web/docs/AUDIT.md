# Auditoria técnica — 2026-09-25

Auditoria de segurança, correção e qualidade do Aureon Agenda, cobrindo os
22 pontos de verificação pedidos (RLS, tenancy, controle de acesso, rotas
protegidas, exposição de dados administrativos, service role key,
validação no servidor, inputs maliciosos, IDs/business_id manipulados,
slugs, APIs, webhooks, uploads, storage policies, logs, erros, race
conditions, duplicidade, timezone, cancelamento, permissões owner/staff),
mais performance, SEO e acessibilidade.

Metodologia: além de leitura de código, cada policy/função/constraint
crítica foi validada contra um Postgres 16 local real (migrações
aplicadas na ordem, roles `anon`/`authenticated`/`service_role`
simulados via `set role` + `request.jwt.claim.sub`), incluindo
concorrência **genuína** (processos `psql` paralelos de verdade, não
sequenciais) para o teste de race condition. Essa abordagem empírica foi
o que revelou os dois problemas mais sérios encontrados (itens 1 e 2 de
"Problemas corrigidos").

## Problemas encontrados

1. **`businesses` expunha `owner_id`, `phone` e `email` para `anon`.**
   RLS filtra *linhas* (só empresas publicadas), não *colunas* — a
   policy de leitura pública, sozinha, deixava qualquer visitante
   consultar esses campos diretamente via PostgREST
   (`...&select=owner_id,phone,email`), mesmo o app nunca renderizando
   isso. Risco: enumeração de donos de empresa e vazamento de PII de
   contato.
2. **Race condition não tratada em `create_public_appointment()`.**
   Sob concorrência sequencial (uma request de cada vez), duas
   tentativas de reservar o mesmo horário sempre produzem o erro
   amigável já tratado (`exclusion_violation` → "slot is no longer
   available"). Sob concorrência **real** (duas conexões simultâneas de
   verdade), ~10–20% das corridas produziam em vez disso um
   `deadlock_detected` (40P01) cru do Postgres, não capturado — ou seja,
   dois clientes clicando "agendar" no mesmo horário no mesmo instante
   podiam ver um erro interno de banco em vez de uma mensagem tratada.
3. **Upload de imagem validado só no cliente.** `ImageUploader`
   verificava tipo/tamanho (5MB, `image/*`) apenas em JavaScript no
   navegador — trivialmente contornável chamando a API de Storage
   diretamente com a chave `anon`, já que a policy de storage só
   verifica *dono do caminho*, não o conteúdo do arquivo.
4. **`DELETE` desnecessário concedido em `appointments`,
   `business_hours` e `professional_hours`.** O app nunca chama
   `.delete()` nessas tabelas (agendamentos são cancelados via mudança
   de status; horários são sempre upsert), mas o grant `DELETE` para
   `authenticated` existia desde o schema original — uma sessão
   comprometida ou uma chamada direta à REST API poderia apagar
   permanentemente histórico de agendamentos (órfãos em
   `notification_deliveries`/`notifications`) ou zerar horários de
   funcionamento.
5. **Conversão de timezone usava `new Date(\`${date}T${time}:00\`)`.**
   Interpretava a data/hora escolhida pelo usuário no timezone do
   *servidor* (UTC em produção), não no timezone configurado da
   empresa — em `src/app/dashboard/page.tsx` (dashboard "hoje"),
   `src/app/dashboard/agenda/page.tsx` (range da agenda) e
   `src/app/dashboard/appointments/actions.ts` (reagendamento), um
   negócio fora de UTC podia ver o dia errado ou reagendar para um
   horário deslocado.
6. **Sem limites de tamanho (`.max()`) em vários campos de texto no Zod.**
   `timezone`, `starts_at`/`ends_at` de bloqueios, e-mail de
   configurações, URL de imagem, nome/telefone/e-mail do cliente no
   agendamento público aceitavam strings arbitrariamente longas —
   não é um exploit direto (o Postgres tem seus próprios limites e não
   há SQL dinâmico em lugar nenhum), mas é uma superfície de
   input malicioso desnecessária (payloads gigantes, DoS de
   armazenamento) sem custo para fechar.
7. **`docs/SECURITY.md` desatualizado.** Afirmava "não há nenhum uso de
   `SUPABASE_SERVICE_ROLE_KEY` neste repositório" — falso desde a Parte
   5/6 (billing), que introduziu uso real em `src/lib/supabase/admin.ts`,
   no webhook de billing e no modo local de billing. Também não
   documentava o modelo de grant de coluna do item 1.
8. **`generateMetadata` da página pública sem OpenGraph/Twitter Card e
   sem `robots.ts`/`sitemap.ts`.** `find src/app -iname "sitemap*" -o
   -iname "robots*"` não retornava nada — nenhuma das duas convenções do
   App Router existia. Links compartilhados em WhatsApp/redes sociais
   (o canal de divulgação mais óbvio para um negócio de agendamento)
   não tinham preview rico, e não havia sitemap indicando ao Google
   quais slugs publicados existem.
9. **Inputs de formulário sem indicador de foco visível.** `Input`,
   `Textarea` e `Select` (`src/components/ui/input.tsx`) usavam
   `outline-none` sem repor um indicador de foco equivalente — só a cor
   da borda mudava (`zinc-300` → `zinc-500`), uma diferença sutil demais
   para WCAG 2.4.7 (Focus Visible), especialmente para quem navega por
   teclado ou tem baixa visão.

## Problemas corrigidos

1. **Vazamento de coluna em `businesses`** — `revoke select on
   public.businesses from anon` + `grant select` explícito só nas
   colunas públicas (`id, name, slug, segment, description, timezone,
   logo_url, cover_url, is_published, created_at, updated_at`)
   (`supabase/migrations/20250924120009_audit_hardening.sql`).
   **Efeito colateral descoberto e corrigido no mesmo pacote**: Postgres
   recusa `select *` inteiro (não filtra silenciosamente) quando o role
   só tem grant em algumas colunas — isso quebrava a própria página
   pública, que usava `.select("*")`. Corrigido reescrevendo a query em
   `src/app/[slug]/page.tsx` com a lista de colunas explícita e
   `.returns<PublicBusinessRow[]>()` para que adicionar uma referência a
   `business.email`/`.owner_id` no futuro vire erro de compilação, não
   `undefined` silencioso em runtime.
2. **`deadlock_detected` sob concorrência real** — `create_public_appointment()`
   redefinida com `exception when deadlock_detected then raise
   exception 'slot is no longer available' using errcode = '23P01';`,
   ao lado do tratamento já existente de `exclusion_violation`. Validado
   com 10 corridas consecutivas de concorrência real pós-fix: zero
   vazamentos de erro cru.
3. **Upload sem limite no servidor** — bucket `business-assets` agora
   tem `file_size_limit = 5242880` (5MB) e `allowed_mime_types` restrito
   a `image/jpeg`, `image/png`, `image/webp`, `image/gif`, aplicado pelo
   próprio Storage, independente do que o cliente envie.
4. **`DELETE` desnecessário** — revogado de `appointments`,
   `business_hours` e `professional_hours` para `authenticated`; zero
   mudança funcional (o app nunca usava esse grant).
5. **Timezone em cálculos de data** — nova função
   `zonedDateTimeToUtcISO()` em `src/lib/date-utils.ts` (conversão
   wall-clock → UTC correta usando `Intl.DateTimeFormat` para descobrir
   o offset real do timezone, sem depender de nenhuma lib de datas);
   `dayRangeISO()`/`rangeISO()` agora exigem o timezone da empresa;
   `todayKeyInTimeZone()` substitui `toDateKey(new Date())` (que lia o
   relógio do servidor). Aplicado em `dashboard/page.tsx`,
   `dashboard/agenda/page.tsx` e `dashboard/appointments/actions.ts`
   (reagendamento). 10 testes novos em `src/lib/date-utils.test.ts`
   (offset fixo, virada de dia, UTC no-op, transição de DST em
   `America/New_York`, precisão de milissegundo).
6. **Limites de tamanho de input** — `.max()` adicionado em `timezone`,
   `starts_at`/`ends_at` de bloqueios, e-mail de configurações e de
   notificação, URL de imagem, e `customer_name`/`customer_phone`/
   `customer_email` do agendamento público (que antes nem tinham
   `.max()`) em `src/lib/validations.ts` e
   `src/app/dashboard/customers/actions.ts`.
7. **`docs/SECURITY.md` atualizado** — nova seção "RLS filtra linhas,
   não colunas" explicando o modelo de grant de coluna (item 1); seção
   "Segredos" reescrita listando os três pontos reais de uso da service
   role key e por que cada um é seguro (server-only, nunca em Client
   Component, nunca confia em `business_id` do cliente sem resolver a
   sessão primeiro); nota sobre os limites de storage; link para este
   relatório.
8. **SEO** — `generateMetadata` em `[slug]/page.tsx` agora inclui
   `openGraph` (title/description/url/image de capa), `twitter` (summary
   large image) e `alternates.canonical`; página não encontrada retorna
   `robots: { index: false }` em vez de metadata vazia. Adicionado
   `metadataBase` no layout raiz (usa `NEXT_PUBLIC_SITE_URL`, já usado
   em outras partes do app). Novos `src/app/robots.ts` (libera `/` e
   `/[slug]`, bloqueia `/dashboard`, `/api`, `/login`, `/signup`,
   `/onboarding`) e `src/app/sitemap.ts` (lista o root + todo slug
   publicado, com `lastModified` vindo de `updated_at`) — confirmados no
   build (`○ /robots.txt`, `ƒ /sitemap.xml`).
9. **Foco visível** — `Input`, `Textarea` e `Select` ganharam
   `focus-visible:ring-2 focus-visible:ring-zinc-900/20`, um único ponto
   de mudança que corrige o contraste de foco em todo formulário do
   dashboard e da página pública de uma vez (15+ pontos de uso).

## Cobertura de testes adicionada

Novo `supabase/tests/db.sql` — suíte de regressão SQL permanente (não
efêmera), rodada contra Postgres real com duas empresas fixture (A/B) e
um usuário "estranho". Cobre, em seções: AUTH (login, cadastro, usuário
sem empresa, usuário com empresa), TENANCY (leitura e escrita —
`services`/`professionals` são intencionalmente legíveis publicamente
para a storefront, então o teste de isolamento de leitura usa
`customers`, que não é; o teste de isolamento de escrita cobre update e
delete cruzados em toda tabela operacional), BOOKING (slot livre, slot
ocupado, `blocked_times`, fora do horário comercial, duração do serviço,
e documentação explícita de que back-to-back sem buffer é permitido —
ver "Riscos restantes"), CANCELAMENTO, PUBLIC PAGE (slug existente,
inexistente, empresa despublicada), CRUD (serviços, profissionais,
clientes, agenda), NOTIFICATIONS, BILLING (webhook duplicado via a
constraint `unique(provider, provider_event_id)`, mudança de status) e
AUDIT HARDENING (as correções acima). Resultado atual: `ALL ASSERTIONS
PASSED`. A concorrência real do item 2 acima foi validada à parte, com
processos `psql` paralelos de verdade (não cabe no formato sequencial de
`db.sql`).

`src/lib/date-utils.test.ts` cobre a lógica de timezone isoladamente (10
testes, incluindo DST).

## Performance

- **N+1**: não encontrado. O padrão consistente em todo o dashboard é
  buscar as linhas principais e usar `.in()` para buscar relacionadas em
  lote, unindo em JS (ex.: agendamentos + clientes + profissionais numa
  página) — não há loop fazendo uma query por linha.
- **Índices**: as tabelas mais consultadas já têm índice nas colunas de
  filtro usadas (`idx_appointments_business_id`,
  `idx_appointments_professional_id`, `idx_appointments_customer_id`,
  `idx_customers_business_id`, `idx_services_business_id`,
  `idx_notifications_recipient`, `idx_notification_deliveries_pending`,
  `idx_notification_deliveries_business_id`,
  `idx_billing_webhook_events_received_at`,
  `idx_subscriptions_provider_subscription_id`,
  `idx_business_members_user_id`, `idx_blocked_times_business_id`,
  `idx_blocked_times_professional_id`). Correção em relação a uma versão
  anterior deste relatório: `blocked_times` **já tinha** índice em
  `business_id` e `professional_id` desde `20250924120002_schema.sql` —
  a afirmação de que só tinha a PK estava errada; confirmado consultando
  `pg_indexes` contra uma migração real, não por leitura de código.
- **Dados carregados desnecessariamente**: a página pública usa agora
  select explícito em `businesses` (efeito colateral do fix de
  segurança); as demais queries do dashboard já usavam `.select()` com
  colunas específicas na maioria dos casos, não `select("*")`
  indiscriminado.
- **Componentes pesados**: nada fora do padrão — a página mais complexa
  (agenda em modo mês) já pagina por range de data no servidor via
  `rangeISO()`, não carrega o histórico inteiro no cliente.

## SEO

Ver "Problemas encontrados"/"corrigidos" itens 8. Após o fix:
`generateMetadata` cobre title, description, canonical, OpenGraph e
Twitter Card; `robots.ts` e `sitemap.ts` existem e aparecem no build
(`○ /robots.txt`, `ƒ /sitemap.xml`).

## Acessibilidade

- **Labels**: todo input de formulário usa `<Label htmlFor>` associado
  (padrão consistente, verificado por amostragem em login, cadastro,
  onboarding e formulários do dashboard).
- **Teclado**: nenhum handler depende de mouse (`onClick` em `<button>`
  nativo ou `<Link>`, sem `<div onClick>` custom sem role/tabIndex).
- **Foco**: corrigido (ver item 9 acima).
- **Botões**: botões só-ícone (sino de notificação, setas de reordenar
  serviço) já tinham `aria-label`/`title`; botões de texto (Editar,
  Cancelar, Marcar como lida, etc.) usam o próprio texto como nome
  acessível — nenhum caso de botão sem nome acessível encontrado.
- **Contraste**: paleta `zinc`/`emerald`/`red` do Tailwind usada em todo
  o app fica dentro de AA para texto normal nos pares usados (texto
  `zinc-900`/`zinc-700` sobre fundo branco, mensagens de erro em
  `red-600` sobre branco).
- **Mensagens de erro**: `FieldError` renderiza a mensagem visivelmente
  abaixo do campo, mas **não** está associada via `aria-describedby`/
  `aria-invalid` ao input correspondente (ver "Riscos restantes" — não
  corrigido nesta auditoria por exigir tocar os 15 pontos de uso
  individualmente).

## Riscos restantes

Itens investigados e deliberadamente **não corrigidos** por exigirem
decisão de produto ou funcionalidade nova (fora do escopo "não adicione
grandes funcionalidades novas" desta auditoria) ou por serem de baixo
risco/custo de correção desproporcional:

1. **Sem buffer entre agendamentos consecutivos.** Um segundo serviço
   pode ser agendado exatamente no minuto em que o anterior termina, sem
   intervalo. Não é um bug — é uma funcionalidade que nunca existiu.
   Comportamento atual agora documentado explicitamente por um teste em
   `supabase/tests/db.sql` em vez de simplesmente presumido.
2. **`professionals.user_id` legível por `anon`.** O grant de coluna em
   `professionals` ainda é geral (não restrito como `businesses`), então
   um profissional vinculado a um `auth.users.id` tem esse UUID
   correlacionável publicamente. Severidade menor que o item 1 de
   "Problemas corrigidos" (é um UUID, não PII direta), mas seria
   consistente aplicar o mesmo tratamento de grant de coluna.
3. **Assinatura cancelada cai nos mesmos limites de qualquer estado
   não-ativo.** `subscriptions.status = 'canceled'` hoje falha-aberto
   (sem restrição adicional) nos mesmos limites de plano que qualquer
   outro estado não-trial/não-active — não reverte para um tier
   reduzido específico. Decisão de produto, não bug de segurança.
4. **Ausência quase total de logging estruturado em server actions.**
   Confirmado que os poucos `console.*` existentes (2, ambos no webhook
   de billing) só logam mensagens de erro sanitizadas — nenhum payload
   bruto, token ou PII. Mas a ausência quase completa de observabilidade
   fora desse ponto é um risco de prontidão para produção (debugar um
   erro relatado por um usuário exige reproduzir localmente).
5. **`customers.phone` nulo não é deduplicado.** `unique(business_id,
   phone)` não gera conflito quando `phone is null` (semântica padrão do
   Postgres para `UNIQUE`) — comportamento esperado, não um bug, mas
   registrado aqui para não ser redescoberto como suspeita futura.
6. **Mensagens de erro de formulário sem `aria-describedby`.** Ver
   "Acessibilidade" — presentes visualmente, mas não associadas
   programaticamente ao campo. Corrigir exigiria tocar os 15 pontos de
   uso de `FieldError` (gerar `id` no erro e referenciá-lo em
   `aria-describedby`/`aria-invalid` no `Input` correspondente),
   escopo maior que os fixes mecânicos de foco desta auditoria.
## Recomendações

1. Aplicar o mesmo tratamento de grant de coluna do item 1 (Problemas
   corrigidos) em `professionals` para remover `user_id` do alcance de
   `anon`.
2. Decidir e implementar o comportamento correto de limite de plano para
   assinatura cancelada (provavelmente: tratar como se estivesse no
   plano mais restrito, não fail-open).
3. Introduzir logging estruturado mínimo em server actions críticas
   (criação/cancelamento de agendamento, mudanças de billing) — mesmo
   que só `console.error` com contexto (business_id, action), para dar
   um rastro mínimo de produção sem expor PII.
4. Avaliar se vale a pena implementar buffer entre agendamentos como
   configuração opcional por empresa (funcionalidade nova — fora do
   escopo desta auditoria, mas o comportamento atual está documentado e
   testado para não ser uma surpresa).
5. Fechar o gap de `aria-describedby`/`aria-invalid` em mensagens de
   erro de formulário na próxima vez que os componentes de formulário
   forem tocados por outro motivo (não vale um PR dedicado só para
   isso).
6. Rodar `supabase/tests/db.sql` como parte do CI — agora que
   `supabase/tests/fixtures/local-stub.sql` está commitado (ver
   docs/DEPLOY.md "Testes de banco"), a única peça que falta é um step de
   CI que suba um Postgres efêmero, aplique o stub + as migrations, e
   rode a suíte.

## Gate de qualidade

Todos os quatro comandos obrigatórios rodados após as correções acima,
zero erros:

```
npm run lint        # eslint . — limpo
npm run typecheck   # tsc --noEmit — limpo
npm test             # vitest run — 15 arquivos, 114 testes, todos passando
npm run build        # next build — build de produção concluído com sucesso
```
