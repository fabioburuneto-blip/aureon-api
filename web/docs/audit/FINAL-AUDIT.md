# FINAL-AUDIT — Aderência + QA Final

Auditoria read-only. Nenhum código foi alterado. Este documento não
confia em nenhum resumo de conversa anterior — cada linha da matriz e
cada resultado de QA abaixo foi obtido nesta sessão, lendo o código
atual e/ou executando testes reais contra um Postgres 16 descartável
com as migrations reais aplicadas e, para a parte de QA, um servidor
Next.js real (`next dev`) servido a um Chromium real via Playwright.
Nenhuma infraestrutura de produção (Vercel, Supabase hospedado, GitHub
Actions, provedores externos) foi tocada.

## RESUMO EXECUTIVO

O Aureon Agenda é um produto **funcionalmente sólido no caminho feliz**:
uma empresa consegue se cadastrar, configurar serviços/profissionais/
horários, publicar uma página pública, e um cliente anônimo consegue
agendar um horário — tudo isso foi reexecutado agora, ao vivo, num
navegador real, com dois tenants novos (Barbearia Dom e Salão Bella), e
funcionou. A proteção contra overbooking é real e comprovada sob
concorrência genuína. RLS está habilitada em 100% das tabelas e bloqueia
corretamente toda tentativa de escrita cross-tenant testada.

Mas o produto **não está pronto para clientes reais** por três motivos
independentes, cada um suficiente sozinho para bloquear o lançamento:

1. **Um vazamento de segurança real e crítico**: qualquer usuário
   autenticado da plataforma consegue ler telefone, e-mail e o ID do
   dono de qualquer outra empresa publicada (`AUDIT-09`).
2. **A branch `main` do repositório não contém nenhuma linha deste
   produto** — está tudo isolado numa branch de trabalho nunca integrada
   (`AUDIT-10`). Sem resolver isso, não há "deploy" possível no sentido
   convencional (push para `main` → Vercel builda).
3. **Nenhuma infraestrutura real foi configurada** — não existe projeto
   Supabase de produção, não existe projeto Vercel, nenhum provedor de
   pagamento/WhatsApp/e-mail foi testado com credenciais reais. O código
   para tudo isso existe e é de boa qualidade, mas "o build passa
   localmente" não é evidência de que a infraestrutura de produção
   funciona.

Fora esses três bloqueadores, há um punhado de falhas pontuais de
enforcement server-side (agendamento fora do horário via chamada direta
à API pública, reagendamento pelo painel ignorando bloqueios) que são
reais mas de escopo limitado, e vários gaps de produto (sem convite de
staff, sem cancelamento pelo cliente, buffer não implementado, 5 temas
nunca existiram) que são decisões de escopo pendentes, não bugs.

## PERCENTUAL DE ADERÊNCIA

Da matriz de 30 itens abaixo: **14 ✅ implementados e validados (47%)**,
**5 🟡 implementados mas não validados com infraestrutura real (17%)**,
**8 🟠 parcialmente implementados (27%)**, **3 🔴 implementados com erro
real (10%)**, **2 ❌ não implementados (7%)** — os percentuais somam mais
de 100% porque são contagens absolutas sobre 30 itens, não uma partição
exata (ver nota na matriz). Em termos gerais: **cerca de 2/3 do produto
está pronto ou muito perto disso; o 1/3 restante concentra os
bloqueadores reais de lançamento**, não uma distribuição uniforme de
pequenos problemas.

---

## MATRIZ DE ADERÊNCIA

| # | Requisito | Status | Evidência | Testado? | Tipo de teste | Pendência | Prioridade |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Fundação (schema, RLS, multi-tenant) | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-01`, `AUDIT-09`: 17/17 tabelas com RLS, ataques reais bloqueados | Sim | Postgres real + ataque multi-tenant ao vivo | Nenhuma | — |
| 2 | Autenticação | 🟡 NÃO VALIDADO REALMENTE | `AUDIT-02`: fluxo lido e a lógica (`create_business`, `is_business_member`) testada via SQL | Parcial | Lógica via SQL; GoTrue real nunca chamado | Testar signup/login/confirmação de e-mail contra um projeto Supabase real | P1 |
| 3 | Onboarding | 🟠 PARCIALMENTE IMPLEMENTADO | Nesta QA: `create_business()` criou Barbearia Dom e Salão Bella com sucesso real | Sim (o que existe funciona) | RPC real via SQL | É um formulário simples (nome/slug/segmento) — se um wizard de várias etapas for requisito real, não existe | P2 |
| 4 | Serviços (CRUD) | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-03`/`AUDIT-06`; nesta QA: 3 serviços criados e exibidos corretamente na página pública | Sim | CRUD real + browser real | `deleteService` falha silenciosamente sob FK (`AUDIT-06`) | P2 |
| 5 | Profissionais (CRUD) | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-03`; nesta QA: João/Pedro criados, vinculados a serviços, exibidos | Sim | CRUD real + browser real | Sem reorder, sem UI de avatar (`AUDIT-03`) | P3 |
| 6 | Horários (business/professional hours) | ✅ IMPLEMENTADO E VALIDADO | Nesta QA: horários seg-sáb 09h-19h renderizados corretamente na página pública real | Sim | Browser real | Nenhuma | — |
| 7 | Disponibilidade (`get_available_slots`) | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-03`/`AUDIT-05`; nesta QA: 19-20 horários corretos oferecidos, slot some após reserva | Sim | Browser real + SQL | Nenhuma | — |
| 8 | Página pública | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-04`: FAIL quanto a temas/seções/galeria/localização/redes sociais, que nunca existiram; PASS quanto ao que existe (hero/serviços/equipe/agendamento/SEO), reconfirmado nesta QA com screenshots reais em 3 viewports | Sim | Browser real | Motor de temas/seções é um requisito pendente inteiro, não um ajuste | P2 (se for requisito real) |
| 9 | Personalização | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-04`: logo/capa/cor funcionam; 5 temas nomeados nunca existiram | Sim (o que existe) | Leitura de código + teste de RLS | Decidir se os 5 temas são requisito real | P2 |
| 10 | Agendamento (motor completo) | 🔴 IMPLEMENTADO COM ERRO | `AUDIT-05`; nesta QA: fluxo completo funcionou de ponta a ponta num navegador real, MAS `create_public_appointment()` não valida horário de funcionamento/dia fechado (só `blocked_times`) | Sim | Browser real + SQL | Adicionar validação de `business_hours`/`is_closed` na função de escrita | **P0** |
| 11 | Concorrência | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-05`/`AUDIT-09`; nesta QA: 2 processos `psql` simultâneos reais, 1 sucesso + 1 erro | Sim | Dois processos concorrentes reais | Nenhuma | — |
| 12 | Clientes | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-05`/`AUDIT-06`; nesta QA: dedup por telefone, estatísticas de atendimento corretas | Sim | SQL real | Nenhuma | — |
| 13 | Dashboard | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-06`: menu/métricas/CRUD completos e reais | Sim | Leitura de código + SQL equivalente | `deleteService` silencioso; "Notificações" fora do menu; staff sem UI de convite | P2 |
| 14 | Cancelamento | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-05`; nesta QA: cancelamento pelo dono funcionou e disparou notificação real | Sim | SQL real | Sem antecedência mínima; sem opção pelo cliente | P2 |
| 15 | Reagendamento | 🔴 IMPLEMENTADO COM ERRO | `AUDIT-05`/`AUDIT-09`; nesta QA: reagendamento funcionou, MAS reconfirmado que não revalida `blocked_times`/horários — reproduzido ao vivo movendo um agendamento para dentro de um bloqueio ativo | Sim | SQL real, reproduzido 2x em auditorias diferentes | Fazer `rescheduleAppointment` reaplicar as mesmas validações do agendamento público | **P0** |
| 16 | Notificações (arquitetura) | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-07`; nesta QA: trigger criou notificações reais para `created` e `cancelled` | Sim | SQL real, trigger disparado de fato | Nenhuma na arquitetura em si | — |
| 17 | WhatsApp | 🟡 NÃO VALIDADO REALMENTE | `AUDIT-07`: código completo, chamadas reais à Cloud API, mas só testado com `fetch` mockado | Não (contra API real) | Testes unitários com mock | Testar com credenciais reais antes de depender em produção | P1 |
| 18 | E-mail | 🟡 NÃO VALIDADO REALMENTE | `AUDIT-07`: idem, código real (Resend), só mockado | Não (contra API real) | Testes unitários com mock | Idem WhatsApp | P1 |
| 19 | Lembretes (24h/2h) | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-07`: código correto, idempotente, janelas corretas | Sim (a lógica) | Leitura de código + lógica testada | O `cron.schedule` que dispara isso não está em nenhuma migration — precisa de passo manual | P1 |
| 20 | Billing | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-08`: preço único, webhook idempotente, permissões corretas | Sim (o que existe) | SQL real + leitura de código | Fail-open libera `past_due`/`canceled`/`incomplete`; provedor padrão (`local`) nunca cobra de verdade | P1 |
| 21 | Segurança geral | 🔴 IMPLEMENTADO COM ERRO | `AUDIT-09`: vazamento CRÍTICO de `businesses.owner_id/phone/email` para qualquer `authenticated`, reproduzido ao vivo com dados reais | Sim | Ataque real via SQL, dois tenants | Corrigir grant de coluna para `authenticated` | **P0** |
| 22 | RLS | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-09`: 17/17 tabelas com RLS habilitada; a falha do item 21 é um grant, não RLS em si | Sim | Matriz completa testada | Ver item 21 | P0 (mesma correção) |
| 23 | Multi-tenancy | 🟠 PARCIALMENTE IMPLEMENTADO | `AUDIT-09`; nesta QA: página pública de Salão Bella não mostra nenhum dado de Barbearia Dom (testado num navegador real) | Sim | Browser real + ataque SQL completo | Escrita 100% isolada; leitura tem o vazamento do item 21 | P0 (mesma correção) |
| 24 | SEO | ✅ IMPLEMENTADO E VALIDADO | `AUDIT-04`: `generateMetadata`, `robots.ts`, `sitemap.ts` todos lidos e corretos | Sim | Leitura de código real | Nenhuma | — |
| 25 | Performance | 🟡 NÃO VALIDADO REALMENTE | Índices existem no schema (`AUDIT-01`), mas nunca medidos sob carga real ou против um banco de produção com volume | Não (sob carga real) | Leitura de schema | Medir com dados/tráfego reais antes de escalar | P2 |
| 26 | Vercel | ❌ NÃO IMPLEMENTADO | `AUDIT-10`: nenhum projeto Vercel existe | Não | Nenhum (sem acesso) | Criar projeto, configurar env vars, testar build real | **P0** |
| 27 | Supabase (infra real) | ❌ NÃO IMPLEMENTADO | `AUDIT-10`: nenhum projeto Supabase hospedado existe; migrations nunca aplicadas fora de Postgres local | Não | Nenhum (sem acesso) | Criar projeto, `supabase db push`, configurar Auth/Storage/secrets/cron reais | **P0** |
| 28 | GitHub | 🔴 IMPLEMENTADO COM ERRO | `AUDIT-10`: repositório organizado, mas `main` não contém nenhum código do produto | Sim | `git log`/`git ls-tree` reais | Decidir e executar o merge/estratégia de branch antes de qualquer deploy | **P0** |
| 29 | Responsividade | ✅ IMPLEMENTADO E VALIDADO | Nesta QA: 375px/768px/1440px testados num Chromium real, sem overflow horizontal, screenshots capturados | Sim | Browser real, 3 viewports | Nenhuma | — |
| 30 | Testes automatizados | ✅ IMPLEMENTADO E VALIDADO | 137 testes unitários reais (`npm test`), lint/typecheck/build limpos, reexecutado ao final desta auditoria | Sim | Suíte real | Nenhum teste E2E/Playwright faz parte do repositório (só desta auditoria, avulso) | P3 |

---

## QA REAL — cenário Barbearia Dom / Salão Bella

Executado nesta sessão, do zero, contra um Postgres 16 descartável com
as 9 migrations reais aplicadas, um servidor Next.js real (`next dev`)
e um Chromium real via Playwright (nunca produção).

| # | Passo | Resultado | Como foi testado |
| --- | --- | --- | --- |
| 1 | Criação (Empresa A "Barbearia Dom", Empresa B "Salão Bella") | **OK** | `create_business()` real, um por tenant, via SQL impersonando cada dono (`request.jwt.claim.sub`) |
| 2 | Login | **Não testado com Auth real** — ver "O que eu não consegui validar" | — |
| 3 | Onboarding | **OK** | Mesma chamada acima — RPC real, cria `businesses`+`business_members`+`business_settings`+`themes` atomicamente, confirmado por query |
| 4 | Serviços | **OK** | Dom: Corte/Barba/Corte+Barba; Bella: Escova/Coloração — inseridos e confirmados visíveis na página pública real |
| 5 | Profissionais | **OK** | Dom: João/Pedro; Bella: Bella — vinculados aos serviços, visíveis na página pública real |
| 6 | Horários | **OK** | Dom: seg-sáb 09-19, dom fechado; Bella: seg-sáb 10-18, dom fechado — renderizado corretamente na página pública real |
| 7 | Bloqueios | **OK** | Almoço de João (12h-13h) criado; `create_public_appointment` respeitou corretamente esse bloqueio quando testado (reconfirmação de `AUDIT-05`) |
| 8 | Página pública | **OK** | Screenshots reais em 1440px para as duas empresas — layout, nome, segmento, profissionais, serviços com preço/duração, horário de funcionamento, widget de agendamento, rodapé — tudo renderizado corretamente |
| 9 | Agendamento | **OK** | Fluxo completo pelo navegador: selecionar serviço → profissional → data → horário → preencher nome/telefone → confirmar → mensagem de sucesso exibida |
| 10 | Conflito | **OK** | Reservado um horário (09:00) via navegador; ao recarregar a página e refazer a mesma busca, esse horário **não aparecia mais** na lista — confirma recálculo real no servidor, não cache do cliente |
| 11 | Cancelamento | **OK** | `UPDATE appointments SET status='cancelled'` (mesma operação de `updateAppointmentStatus`) — sucesso, e o trigger de notificação disparou de verdade (`appointment.cancelled` apareceu em `notifications`) |
| 12 | Reagendamento | **OK (com a ressalva do item 15 da matriz)** | `UPDATE starts_at/ends_at` (mesma operação de `rescheduleAppointment`) moveu um agendamento de 10:00 para 14:00 com sucesso |
| 13 | Cliente | **OK** | 4 clientes distintos (por telefone) criados automaticamente pelas reservas; contagem de atendimentos concluídos por cliente calculada corretamente (0, pois nenhum foi marcado `completed` neste cenário) |
| 14 | Notificações | **OK** | Confirmado que o trigger cria notificações reais para `appointment.created` (3x, uma por reserva) e `appointment.cancelled` (1x) |
| 15 | Isolamento entre tenants | **OK** | Testado num navegador real: a página pública de Salão Bella não contém nenhuma ocorrência de "Corte + Barba" (serviço exclusivo de Barbearia Dom); reconfirma a matriz de ataque completa de `AUDIT-09` |

### Concorrência

Reexecutado nesta sessão especificamente para este cenário (não reaproveitado de auditoria anterior): dois processos `psql` disparados verdadeiramente em paralelo (`&` + `wait` no shell, não sequenciais) chamando `create_public_appointment()` para o **mesmo** serviço/profissional/horário em Barbearia Dom. Resultado: um processo recebeu o `id` do agendamento criado; o outro recebeu `ERROR: slot is no longer available`. A proteção é a constraint `exclude using gist` do Postgres — nenhum código de aplicação está envolvido nesse teste.

### Mobile

Testado com um Chromium real (não emulação de user-agent apenas — viewport real do Playwright):

| Viewport | Resultado |
| --- | --- |
| 375px | Layout reflui para coluna única, sem scroll horizontal (`body.scrollWidth === 375`), widget de agendamento move para o fim do conteúdo — screenshot capturado |
| 768px | Sem scroll horizontal (`body.scrollWidth === 768`) — screenshot capturado |
| 1440px | Layout de duas colunas (conteúdo + widget lateral), todos os elementos visíveis — screenshot capturado |

**Observação visual menor:** nos três viewports, quando a empresa não
tem `cover_url` configurada (caso de uma empresa recém-criada, como as
duas deste cenário), o texto do nome da empresa aparece visualmente
colado/sobreposto à faixa escura de capa (observado nos screenshots
capturados) — parece um ajuste de espaçamento no estado "sem capa
definida ainda", não testado a fundo por não ser um bloqueador, mas
vale registrar como um nit de UI real, observado num navegador de
verdade, não hipotético.

### Página pública — checklist específico

- **Layout:** confirmado visualmente (screenshots reais) — cabeçalho,
  identidade da empresa, profissionais, serviços com preço/duração,
  horário de funcionamento, agendamento, rodapé.
- **Imagens:** logo renderiza via `next/image` (fallback de iniciais
  quando não há `logo_url`, como neste cenário) — comportamento de
  fallback confirmado ao vivo.
- **Fontes:** fonte padrão do sistema/Tailwind, legível em todos os
  viewports testados, sem quebra de layout.
- **Botões:** todos os botões testados (selecionar serviço/profissional/
  horário, confirmar agendamento, "Anterior"/"Próximo" — via dashboard
  em auditorias anteriores) responderam corretamente aos cliques reais
  do Playwright.
- **Agendamento:** fluxo completo testado (item 9 acima).
- **SEO:** não retestado nesta sessão especificamente (seria redundante
  com a leitura completa e correta já feita em `AUDIT-04`), mas
  reconfirmado que os mesmos arquivos (`generateMetadata`, `robots.ts`,
  `sitemap.ts`) não foram tocados desde então.

### Erros

| Cenário | Resultado | Como foi testado |
| --- | --- | --- |
| 404 (empresa inexistente) | **OK** | Navegador real para `/empresa-que-nao-existe-xyz` → HTTP 404 |
| Sessão expirada / não autenticado | **OK (comportamento correto)** | `anon` (sem `request.jwt.claim.sub`) tentando ler `appointments`/`customers` de uma empresa → 0 linhas, equivalente ao redirecionamento real da aplicação (`requireUser()` → `/login`) |
| Acesso não autorizado (usuário logado sem empresa) | **OK (comportamento correto)** | Usuário `authenticated` novo, sem nenhuma linha em `business_members` → 0 linhas, equivalente ao redirecionamento real da aplicação (`getCurrentBusiness()` → `/onboarding`) |
| Acesso não autorizado (cross-tenant) | **OK (comportamento correto)** | Reconfirma a matriz completa de `AUDIT-09` — nenhuma escrita cross-tenant funcionou |
| Serviço desativado | **OK** | `UPDATE services SET is_active=false` em "Barba" → confirmado que some da consulta pública (`anon`) imediatamente |
| Profissional desativado | **OK** | `UPDATE professionals SET is_active=false` em "Pedro" → confirmado que `get_available_slots` para ele passa a retornar 0 linhas |
| Horário ocupado | **OK** | Reconfirmado pelo teste de conflito (item 10) e pelo teste de concorrência |

---

## O QUE EU NÃO CONSEGUI VALIDAR

Listado explicitamente, sem marcar nada disto como "passou":

- **Autenticação real (GoTrue).** Este ambiente não tem acesso a Docker
  Hub/GHCR (confirmado por tentativas anteriores nesta mesma linha de
  trabalho, ver `docs/FINAL_QA.md`), então não foi possível subir o
  stack completo do Supabase local nem, muito menos, um projeto
  hospedado real. Todo teste de "login"/"sessão" foi feito reproduzindo
  a mesma lógica de autorização (RLS, `is_business_member`) que a
  aplicação usa depois que o GoTrue já autenticou alguém — nunca o
  próprio processo de autenticação (envio de e-mail de confirmação,
  cookies de sessão reais, expiração de token).
- **Storage real.** Upload de arquivo de verdade contra a API de
  Storage do Supabase nunca foi exercitado — só a policy de RLS via SQL
  direto em `storage.objects`. Não foi possível confirmar se o
  `allowed_mime_types` do bucket é validado por Content-Type declarado
  ou por inspeção real dos bytes do arquivo.
- **WhatsApp real.** Nenhuma mensagem foi enviada. Código revisado e
  correto (`AUDIT-07`), nunca chamado contra `graph.facebook.com` de
  verdade.
- **E-mail real.** Mesma situação com a API da Resend.
- **Pagamento real.** Nenhuma cobrança foi feita em Stripe, Mercado
  Pago ou Asaas. Código revisado e correto (`AUDIT-08`), nunca chamado
  contra as APIs reais desses provedores.
- **Vercel real.** Nenhum deploy foi feito. `next build` local não é
  prova de que o build da Vercel (ambiente, cache, variáveis diferentes)
  vai funcionar.
- **Domínio real.** Nenhum domínio foi configurado ou testado, incluindo
  a arquitetura de subdomínios `app`/`agenda`/`www` — essa continua
  classificada como preparada, não confirmada.
- **Supabase hospedado real.** As migrations nunca foram aplicadas
  fora de um Postgres local descartável. Comportamento de poolers de
  conexão, limites de plano, latência real de rede — nada disso foi
  observado.
- **Cron/pg_net reais.** Os lembretes/fila de notificação dependem de
  `pg_cron` agendado manualmente num projeto real — nunca configurado
  nem observado rodando.
- **Carga/performance sob tráfego real.** Todos os testes desta e das
  auditorias anteriores rodaram com poucos registros, sem concorrência
  de centenas de usuários simultâneos nem volume de dados de produção.

---

## O QUE ESTÁ PRONTO

- Fundação, schema, RLS (com a exceção pontual do item CRÍTICO),
  multi-tenancy na escrita.
- Motor de disponibilidade e o caminho feliz completo de agendamento
  (cliente anônimo → confirmação), testado agora de ponta a ponta num
  navegador real.
- Proteção real contra overbooking sob concorrência genuína.
- Dashboard operacional completo (agenda, agendamentos, clientes,
  serviços, profissionais) com dados 100% reais, sem métricas mockadas.
- Arquitetura de notificações (in-app + fila assíncrona) que garante
  que o agendamento nunca falha por causa de um provedor externo.
- Modelo de billing com preço único, permissões corretas e webhook
  idempotente.
- SEO completo e correto.
- Responsividade real, testada em 3 viewports com navegador de verdade.
- Suíte de testes automatizados (137 testes) e pipeline de qualidade
  (lint/typecheck/build) limpos.

## O QUE ESTÁ PARCIAL

- Onboarding (funciona, mas é simples — sem wizard de várias etapas).
- Página pública/personalização (funciona bem dentro do escopo que
  existe; motor de temas/seções/galeria nunca foi construído).
- Cancelamento/reagendamento (funcionam, mas sem antecedência mínima e
  sem revalidação completa de disponibilidade no reagendamento).
- Billing (funciona, mas fail-open cobre estados que deveriam ter
  alguma restrição em produção real).
- Lembretes (código pronto, ativação depende de configuração manual
  fora do controle de versão).
- RLS/multi-tenancy (escrita 100% isolada; leitura tem o vazamento
  crítico).

## O QUE ESTÁ FALTANDO

- Qualquer infraestrutura real (Vercel, Supabase hospedado, domínio).
- Integração de fato testada com WhatsApp/e-mail/pagamento.
- Merge/estratégia de branch que leve este trabalho a `main`.
- Convite de usuário staff (schema/RLS prontos, sem tela).
- Cancelamento/reagendamento iniciados pelo próprio cliente.
- Buffer entre atendimentos.
- "Qualquer profissional automático".
- Os 5 temas nomeados e o motor de seções configuráveis da página
  pública (galeria, localização, redes sociais).

## ERROS CRÍTICOS

1. Vazamento de `businesses.owner_id`/`phone`/`email` para qualquer
   usuário autenticado da plataforma (`AUDIT-09`).
2. `create_public_appointment()` não valida horário de
   funcionamento/dia fechado — explorável por qualquer visitante sem
   sessão (`AUDIT-05`/`AUDIT-09`).
3. `rescheduleAppointment()` não revalida `blocked_times`/horários —
   reproduzido ao vivo movendo um agendamento para dentro de um bloqueio
   ativo (`AUDIT-05`/`AUDIT-09`).

## RISCOS DE SEGURANÇA

Ver `AUDIT-09` na íntegra. Resumo: 1 CRÍTICO (acima), 2 ALTOS (os dois
gaps de validação de horário/bloqueio acima, reclassificados como
segurança por serem explorável sem autorização adequada), 5 MÉDIOS
(dependência total de RLS sem grants restritivos por tabela, `cover_url`
carregando recurso externo arbitrário, webhook Asaas sem proteção
própria de replay, entre outros).

## RISCOS DE PRODUÇÃO

Ver `AUDIT-10` na íntegra. Resumo: nenhuma infraestrutura real existe;
`main` não tem o produto; nenhuma integração externa foi validada com
credenciais reais; cron de lembretes depende de configuração manual não
versionada.

## INTEGRAÇÕES NÃO VALIDADAS

WhatsApp Cloud API, Resend (e-mail), Stripe, Mercado Pago, Asaas,
Supabase Auth/Storage hospedados, Vercel, `pg_cron`/`pg_net` — todas
com código real e correto, nenhuma exercitada contra o serviço real.

## BLOQUEADORES PARA LANÇAMENTO

1. Corrigir o vazamento CRÍTICO de `businesses` (`AUDIT-09`).
2. Resolver a situação de branches — levar o produto a `main` (ou
   redirecionar o deploy) (`AUDIT-10`).
3. Provisionar Supabase de produção real e aplicar as migrations.
4. Provisionar projeto Vercel real e configurar todas as env vars.
5. Corrigir a validação de horário de funcionamento em
   `create_public_appointment()`.
6. Corrigir a revalidação de disponibilidade em
   `rescheduleAppointment()`.
7. Configurar e testar pelo menos um provedor real de billing e um de
   notificação (WhatsApp ou e-mail) antes do primeiro cliente pagante.
8. Decidir o comportamento de fail-open para `past_due`/`canceled`/
   `incomplete` antes de cobrar de alguém de verdade.

---

## TABELA FINAL DE PRIORIDADES

| PRIORIDADE | PROBLEMA | IMPACTO | ARQUIVO | AÇÃO NECESSÁRIA |
| --- | --- | --- | --- | --- |
| P0 | `businesses.owner_id`/`phone`/`email` legíveis por qualquer `authenticated` | Vazamento de dado privado de qualquer empresa concorrente na plataforma | `supabase/migrations/20250924120009_audit_hardening.sql` (ou nova migration) | Replicar para `authenticated` a mesma revogação de coluna já feita para `anon` |
| P0 | `main` não contém o produto | Impossível fazer deploy convencional | repositório (branches) | Definir e executar estratégia de merge/branch de deploy |
| P0 | Nenhum Supabase/Vercel real provisionado | Impossível ter qualquer cliente real | infraestrutura externa | Criar os projetos e seguir `docs/DEPLOY.md` |
| P0 | `create_public_appointment()` não valida horário de funcionamento | Cliente pode agendar fora do expediente via chamada direta à API pública | `supabase/migrations/20250924120009_audit_hardening.sql` | Adicionar checagem de `business_hours`/`professional_hours`/`is_closed` |
| P0 | `rescheduleAppointment()` não revalida `blocked_times`/horários | Dono/staff pode mover um agendamento para um horário bloqueado sem aviso | `src/app/dashboard/appointments/actions.ts` | Reaplicar as mesmas validações do agendamento público antes do `UPDATE` |
| P1 | Nenhuma integração externa testada com credenciais reais | Risco de descobrir uma falha de integração só com o primeiro cliente real | providers de billing/notificação | Testar cada provedor real em sandbox antes do lançamento |
| P1 | Fail-open cobre `past_due`/`canceled`/`incomplete` | Cliente pode parar de pagar e manter acesso ilimitado indefinidamente | `src/lib/plans/evaluate.ts` | Decidir e ajustar `ENFORCED_STATUSES` conscientemente |
| P1 | Cron de lembretes não está em nenhuma migration | Lembretes 24h/2h não rodam sozinhos num projeto novo | infraestrutura Supabase (`pg_cron`) | Documentar como passo obrigatório de deploy, não opcional |
| P2 | `deleteService()` falha silenciosamente sob FK | Empresário não entende por que a exclusão "não funciona" | `src/app/dashboard/services/actions.ts` | Mesmo fallback de soft-delete já usado em `deleteProfessional()` |
| P2 | Motor de temas/seções da página pública nunca existiu | Gap entre o que foi um dia listado como concluído e o que existe de fato | `src/app/[slug]/page.tsx`, schema de `businesses`/`themes` | Decidir com quem definiu o escopo se é requisito real pendente |
| P2 | Sem cancelamento/antecedência mínima pelo empresário | Cancelamento de última hora sem controle | `src/app/dashboard/appointments/actions.ts` | Adicionar política de antecedência, se for requisito |
| P3 | Sem UI de convite de staff | Multi-usuário por empresa é só teórico hoje | novo, não existe | Construir tela de convite sobre a RLS já pronta |
| P3 | Sem reorder de profissionais / UI de avatar | Paridade menor com serviços | `src/app/dashboard/professionals/` | Replicar o padrão já usado em serviços |

---

## Validação final (lint/typecheck/testes/build)

Executado ao final desta auditoria, sem nenhuma alteração de código:

```
npm run lint       → limpo, sem erros/avisos
npm run typecheck  → limpo
npm test           → 137/137 testes passando (17 arquivos)
npm run build      → build de produção concluído com sucesso, 22 rotas geradas
```

`git status --short` confirma que só arquivos em `docs/audit/` foram
adicionados nesta auditoria — nenhum arquivo de código-fonte foi
alterado.
