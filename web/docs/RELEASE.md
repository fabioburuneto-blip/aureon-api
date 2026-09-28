# RELEASE — Branch oficial e fluxo de deploy

## Branch oficial

**`main`** — atualizada em 2026-09-28 via fast-forward puro a partir de
`claude/blissful-edison-4wt18p`, sem merge commit, sem conflito, sem
reescrever nenhum histórico. Contém, lado a lado:

- O projeto **Aureon Agenda** (este SaaS), inteiramente em `web/`.
- O projeto não relacionado **TraderAureonia** (`server.js`,
  `package.json`, `TraderAureonia_Slave.mq5`), que já existia na raiz do
  repositório antes de o Aureon Agenda começar a ser desenvolvido — ver
  `web/README.md` para a nota explícita sobre essa separação.

## Commit atual

```
27c3ceff117fa1671822fefec851b7187c15c231
Fix P0 security/booking findings: businesses leak, hours bypass, reschedule bypass
```

`main`, `origin/main` e `claude/blissful-edison-4wt18p` apontam para
este mesmo commit no momento da escrita deste documento.

## Estratégia utilizada

Investigada e documentada em `docs/audit/GIT-BRANCH-STATE.md` antes de
qualquer execução. Confirmado, com comandos reais (não presumido):

- `git merge-base --is-ancestor main claude/blissful-edison-4wt18p` →
  verdadeiro (main era um ancestral direto).
- `git diff --name-only main claude/blissful-edison-4wt18p -- . ':!web'`
  → vazio (nenhum arquivo fora de `web/` diferia entre as branches).

Como consequência, a atualização foi um **fast-forward puro**:

```bash
git fetch origin main claude/blissful-edison-4wt18p
git checkout -B main origin/main
git merge --ff-only origin/claude/blissful-edison-4wt18p
git push origin main
```

Nenhum `--force`, nenhum `reset --hard`, nenhum commit reescrito,
nenhuma branch apagada. `main` só avançou.

## Comandos de validação

Executados depois do fast-forward, com `main` já no estado atual,
confirmando zero regressão:

```bash
cd web
npm run lint       # limpo
npm run typecheck  # limpo
npm test           # 137/137 testes passando
npm run build      # build de produção concluído, 22 rotas geradas
```

## Como futuros deploys devem funcionar

```
GitHub (main) ──push──▶ Vercel (build + hosting do Next.js)
                                 │
                                 ▼
                       Supabase (Postgres + Auth + Storage
                                  + Edge Functions)
```

- **Todo trabalho de código continua sendo feito em uma branch de
  trabalho** (ex.: `claude/blissful-edison-4wt18p` ou uma nova branch de
  feature), nunca diretamente em `main`.
- **`main` só avança por fast-forward ou merge sem conflito**, a partir
  de uma branch já validada (lint/typecheck/test/build limpos) — nunca
  por push direto de trabalho em andamento.
- A Vercel deve ser configurada para acompanhar `main` como branch de
  produção (Project Settings → Git → Production Branch). Nenhum projeto
  Vercel real está conectado a este repositório ainda — ver
  `docs/DEPLOY.md` para o passo a passo completo de criação do projeto,
  e `docs/audit/AUDIT-10-PRODUCTION.md` para o que falta antes do
  primeiro deploy real.
- A Vercel nunca aplica migrations do Supabase nem faz deploy das Edge
  Functions — esses continuam sendo passos manuais (ou de CI) separados
  contra o projeto Supabase de produção, documentados em
  `docs/DEPLOY.md`.
- Sempre que `main` avançar, os quatro comandos de validação acima devem
  ter sido executados e passado limpos antes do push — este documento
  existe para que isso não dependa de lembrar a sequência certa.
