# QA final — 2026-09-25

QA de ponta a ponta do Aureon Agenda, tratando o sistema como uma pessoa
usuária real trataria — sem presumir que nenhuma funcionalidade estava
correta antes de exercitá-la de fato.

## Metodologia (leia antes dos resultados)

O ambiente de execução não tem acesso a Docker Hub/GitHub Container
Registry (política de rede do ambiente bloqueia essas origens — confirmado
via `curl http://127.0.0.1:41255/__agentproxy/status`, que registra
`connect_rejected` para `d2glxqk2uabbnd.cloudfront.net` e
`pkg-containers.githubusercontent.com`), então **não foi possível subir o
stack completo do Supabase local** (`supabase start`, que depende de
imagens Docker) para testar tudo através de um backend 100% real.

Diante disso, este QA foi feito em duas frentes, ambas reais — nenhuma das
duas é "assumir que funciona":

1. **Página pública, de ponta a ponta, num navegador real.** Foi escrito
   um servidor mínimo (`http://localhost:9911`) que implementa só os
   endpoints REST/RPC que a página pública e o widget de agendamento
   realmente chamam (`businesses`, `themes`, `services`, `professionals`,
   `professional_services`, `business_hours`, `get_available_slots`,
   `create_public_appointment`), traduzindo cada chamada para SQL direto
   contra um Postgres 16 real com as migrations reais aplicadas. A
   aplicação Next.js rodou de verdade (`npm run dev` e depois
   `npm run build && npm start`), servida a um Chromium real via
   Playwright — cliques, preenchimento de formulário, navegação,
   viewport mobile, tudo genuíno. Isso valida os Cenários 2, 3, 6 e a
   maior parte do 7 através da UI de fato.
2. **Painel do empresário (autenticado) e verificações de banco, direto
   contra o Postgres real** com as 9 migrations, as RLS policies, os
   triggers e as funções `SECURITY DEFINER` reais aplicadas —
   reproduzindo exatamente a sequência de comandos que cada server action
   do dashboard executa (mesmas tabelas, mesmos filtros, mesmo papel
   `authenticated`/`anon`). Isso não é "ler o código e assumir que está
   certo": é rodar a mesma lógica de autorização/negócio que a aplicação
   roda, só sem o GoTrue (Auth) real por trás do login. Cobre os Cenários
   1, 4, 5 e a metade "dashboard" do 7. Login/cadastro em si (o formulário
   HTTP contra o GoTrue) não foi exercitado por essa mesma razão — mas a
   lógica que ele aciona (`create_business()`, `is_business_member()`
   etc.) foi.

Toda vez que um teste usou uma dessas duas frentes em vez de "clicar em
tudo no navegador com login real", isso está dito explicitamente abaixo.

## Cenário 1 — Empresário: Barbearia Dom

| Passo | Resultado |
| --- | --- |
| Cadastro (`auth.users` → trigger cria `profiles`) | OK |
| Onboarding (`create_business()`, o mesmo RPC que a tela de onboarding chama) | OK — dono vira `owner` em `business_members` |
| Serviços (Corte R$50/45min, Barba R$35/30min, Corte+Barba R$75/75min) | OK, os 3 criados |
| Profissionais (João, Pedro) | OK, ambos vinculados aos 3 serviços |
| Horários (segunda a sábado 09:00–19:00, domingo fechado) | OK |
| Bloqueio (almoço de João, 12:00–13:00) | OK |
| Personalização (tema, cor primária/secundária, logo, capa) | OK — verificado que a página pública renderiza a cor do tema e as duas imagens |
| Publicar | OK — `is_published = true`, visível para `anon` |

Verificado via banco (frente 2) + confirmado visualmente na página pública
renderizada de verdade (frente 1, screenshot abaixo).

## Cenário 2 — Cliente: agendamento como visitante anônimo

Fluxo completo testado num navegador real contra `/barbearia-dom`:
escolher serviço → escolher profissional → escolher data → carregar
horários disponíveis (RPC `get_available_slots` real) → clicar num
horário → preencher nome, telefone (WhatsApp) e e-mail → confirmar (RPC
`create_public_appointment` real). Tela de "Agendamento confirmado!"
apareceu corretamente. **Resultado: OK.**

Conferido no banco, direto: o agendamento apareceu com `status = pending`,
vinculado à empresa, ao serviço, ao profissional e a um novo registro em
`customers` — exatamente o que o dashboard mostraria.

## Cenário 3 — Conflito de horário

Duas abas do navegador, ambas com a mesma empresa/serviço/profissional/
data/horário selecionados. A primeira aba confirma o agendamento; a
segunda aba, com o mesmo horário já selecionado, tenta confirmar logo em
seguida (simulando duas pessoas reais disputando o último horário ao
mesmo tempo). **Resultado: OK — recusado**, com a mensagem amigável "Esse
horário acabou de ser reservado. Escolha outro.", sem erro cru de banco
vazando para a tela.

## Cenário 4 — Cancelamento

Um dos agendamentos criados foi cancelado (mesma operação que o botão
"Cancelar" do dashboard executa: `status = 'cancelled'`). Verificado
depois:

- **Status**: `cancelled` no banco. OK.
- **Agenda**: a consulta que a tela `/dashboard/agenda` usa não filtra por
  status — o agendamento cancelado continua aparecendo no dia, com o
  status correto (não desaparece silenciosamente). OK.
- **Disponibilidade**: reabrindo a página pública num navegador real e
  recarregando os horários daquele dia/profissional/serviço, o horário
  que tinha sido cancelado **voltou a aparecer como disponível**. Testado
  de verdade, não só inferido do schema. OK.
- **Histórico**: a consulta que `/dashboard/customers/[id]` usa continua
  trazendo o agendamento cancelado no histórico do cliente (não é
  apagado, só marcado). OK.

## Cenário 5 — Segunda empresa (Salão Bella) e isolamento multi-tenant

Criada uma segunda empresa completa (Salão Bella, dona diferente, 2
serviços, 1 profissional, tema com cores diferentes). Depois, logada como
dona da Bella, tentativa ativa de:

| Tentativa | Resultado |
| --- | --- |
| Ler `customers` da Barbearia Dom | **0 linhas** (RLS bloqueou) |
| Ler `appointments` da Barbearia Dom | **0 linhas** |
| Ler `notifications` da Barbearia Dom | **0 linhas** |
| Ler `business_settings` da Barbearia Dom | **0 linhas** |
| Ler `blocked_times` da Barbearia Dom | **0 linhas** |
| Cancelar agendamentos da Barbearia Dom | **0 linhas afetadas** |
| Mudar a cor do tema da Barbearia Dom | **0 linhas afetadas** — cor continuou `#0f172a` |

E o inverso (dona da Dom tentando ler `customers` da Bella e desativar os
serviços da Bella): também **0 em tudo**. Nenhuma tentativa de leitura ou
escrita cross-tenant teve sucesso, em nenhuma direção.

Confirmado também pela página pública, cada slug isolado corretamente:
`/barbearia-dom` mostra "Corte, Barba, Corte + Barba" e cor `#0f172a`;
`/salao-bella` mostra "Escova, Coloração" e cor `#7c3aed`. Nunca um vaza
para o outro. **Personalização, serviços, clientes, agendamentos e
notificações — nenhum mistura.**

## Cenário 6 — Mobile

Página pública testada em viewport 375×667 (iPhone SE) e 768×1024
(tablet), navegador real, incluindo um agendamento completo (serviço
Barba, profissional Pedro) do zero até "Agendamento confirmado!" só no
mobile. Resultado:

- Sem scroll horizontal indevido em nenhuma das duas larguras.
- Botões de horário com 34px de altura (acima do mínimo recomendado de
  ~24-32px para toque).
- O widget de agendamento, que fica fixo ao lado no desktop
  (`sticky`, coluna lateral), empilha corretamente abaixo do conteúdo no
  mobile — grid responsivo funcionando como esperado.
- Fluxo completo (escolher tudo, preencher, confirmar) funcionou sem
  nenhum erro.

**Resultado: confortável para alguém chegando pelo Instagram.**

## Cenário 7 — Erros e casos-limite

| Caso | Resultado |
| --- | --- |
| Página inexistente (`/barbearia-que-nao-existe`) | HTTP 404 real, tela "Página não encontrada" com link de volta |
| Serviço desativado | Não aparece no seletor de serviços da página pública |
| Profissional desativado | Não aparece em lugar nenhum da página pública |
| Horário indisponível (domingo, empresa fechada) | Mensagem "Nenhum horário disponível neste dia." |
| Formulário inválido (telefone "123", passa a validação HTML5 mas não o Zod) | Bloqueado antes de qualquer chamada de rede, mensagem "Informe um telefone válido" |
| Sessão expirada / usuário sem permissão | `/dashboard` sem sessão redireciona (307) para `/login` com headers `no-store` corretos — testado de verdade contra o middleware real. Isolamento de permissão entre empresas coberto no Cenário 5 (tentativas de escrita cross-tenant, todas recusadas pelo RLS) |

## Cenário 8 — Build e revisão final

```
npm run lint       -> limpo
npm run typecheck  -> limpo
npm test           -> 137/137 testes passando
npm run build      -> sucesso, 22/22 páginas, zero erros
```

Depois do build, `npm start` (build de produção real, não `next dev`) foi
testado num navegador real em `/`, `/login`, `/signup`, `/barbearia-dom`,
`/salao-bella` e na página inexistente:

- **Console errors**: nenhum, em nenhuma página (exceto o já explicado no
  item de bugs abaixo, que não é um bug do app).
- **Hydration errors**: nenhum — nenhuma página emitiu aviso de mismatch
  entre HTML do servidor e do cliente.
- **Broken links**: nenhum link interno quebrado nas páginas testadas.
- **Imagens**: logo e capa carregam corretamente via `next/image`
  (confirmado com bytes reais de imagem retornando 200) depois do fix
  descrito abaixo.
- **SEO**: `<title>`, `description`, `canonical`, `og:title`,
  `og:description`, `og:url`, `og:image`, `og:type` todos presentes e
  corretos em `/barbearia-dom`. `robots.txt` bloqueia `/dashboard`,
  `/api`, `/login`, `/signup`, `/onboarding` e aponta para o sitemap.
  `sitemap.xml` lista a home e as duas empresas publicadas, com
  `lastmod` correto.
- **Responsividade**: confirmada em 375px e 768px (ver Cenário 6).

Nenhum erro crítico restante. **O projeto pode ser declarado pronto**
dentro do escopo testado (ver "Pendências" para o que não foi coberto e
por quê).

## Bugs encontrados

1. **`next.config.ts` fixava `protocol: "https"` no `remotePattern` de
   imagens do Supabase Storage.** Um projeto Supabase hospedado é sempre
   https, mas o Supabase local (`supabase start`) roda por padrão em
   `http://127.0.0.1:54321` — http, não https. Qualquer pessoa
   desenvolvendo localmente contra um Supabase local real teria a página
   pública quebrando com HTTP 500 ("Invalid src prop... hostname not
   configured") toda vez que uma empresa tivesse logo ou capa. Só não foi
   percebido antes porque nenhuma sessão anterior chegou a rodar o app de
   fato contra uma URL `http://`.
2. **Faltava `images.dangerouslyAllowLocalIP` para desenvolvimento.**
   Mesmo com o protocolo certo, o Next.js tem uma proteção nativa contra
   SSRF que recusa qualquer imagem cujo hostname resolva para um IP
   privado (`127.0.0.1` incluso) — exatamente o que o Supabase local usa.
   Sem isso, toda imagem de logo/capa continuaria falhando (agora com
   "hostname resolved to private IP") para qualquer pessoa rodando
   `supabase start` localmente, mesmo depois do fix acima.

## Bugs corrigidos

Os dois itens acima, em `web/next.config.ts`:

- Protocolo agora é lido da própria `NEXT_PUBLIC_SUPABASE_URL`, não mais
  fixo em `"https"`.
- `dangerouslyAllowLocalIP: true` habilitado **somente quando
  `NODE_ENV === "development"`** — em produção (onde o Supabase é sempre
  um host https público de verdade) a proteção contra SSRF continua
  ativa, sem enfraquecer nada; só o ambiente de desenvolvimento local
  ganha o comportamento correto.

Verificado depois do fix: build de produção limpo, e a imagem de teste
(um PNG real servido pelo servidor de QA) carregando com HTTP 200 de
verdade através do otimizador de imagem do Next.js.

### Não é bug (achados descartados após investigação)

- Durante o teste em modo produção (`npm start`), a imagem de logo da
  Barbearia Dom voltou a dar 400. Isso é **esperado e correto**: em
  produção, `dangerouslyAllowLocalIP` fica desligado de propósito (só
  vale para dev), então a mesma proteção contra SSRF volta a bloquear meu
  servidor de QA por rodar em `localhost` — o que nunca aconteceria
  contra uma URL `https://` real de um projeto Supabase hospedado. Não é
  um problema do produto, é a proteção funcionando como deveria.
- Diversos "erros" de console vistos nas primeiras rodadas de teste (400
  no RPC da segunda aba do Cenário 3, 404 ao visitar a página
  inexistente) são exatamente os resultados esperados desses próprios
  testes — o navegador loga qualquer resposta HTTP ≥400 como "Failed to
  load resource" independente de a aplicação tratar o erro
  corretamente ou não. Não indicam falha da aplicação.

## Pendências

Não cobertos nesta rodada de QA, por depender de um backend Supabase real
(Auth/Storage) que este ambiente não conseguiu provisionar (ver
"Metodologia"):

1. **Login e cadastro através do formulário HTTP real** (contra o GoTrue).
   A lógica que esses fluxos acionam do lado do banco
   (`create_business()`, resolução de `business_members`, etc.) foi
   validada; o formulário em si, com um Auth de verdade por trás
   (confirmação de e-mail, hashing de senha, emissão de sessão), não.
2. **Upload de arquivo de verdade na tela de personalização** (arrastar
   uma imagem, `supabase.storage.upload()` real). O caminho foi validado
   com URLs de imagem definidas diretamente e confirmadas renderizando
   via `next/image`; o clique-arrasta-solta do `ImageUploader` contra uma
   Storage API real não foi exercitado.
3. **Envio real de notificação por WhatsApp/e-mail** (as duas Edge
   Functions chamando a WhatsApp Cloud API / Resend de verdade). A
   criação da notificação in-app (via trigger, no banco) foi confirmada
   funcionando numa sessão anterior; a entrega outbound de verdade
   depende de credenciais de provedor reais e do agendamento via
   `pg_cron`, fora do escopo do que pode ser testado localmente sem eles.
4. **Fluxo de cobrança real** (checkout/webhook contra Mercado
   Pago/Stripe/Asaas de verdade) — coberto por testes unitários
   (`src/lib/billing/providers/*.test.ts`), não por este QA end-to-end.

Recomendação: rodar uma segunda rodada deste mesmo roteiro de QA (os
scripts usados aqui podem ser adaptados) contra um ambiente com Docker
liberado ou contra um projeto Supabase de staging real, cobrindo
especificamente esses quatro pontos antes do primeiro lançamento para
clientes reais.
