# GIT-BRANCH-STATE — Investigação da branch oficial

Nenhuma operação destrutiva foi executada. `main` não foi alterado nem
avançado nesta etapa — a fusão recomendada abaixo é segura mas **não foi
executada**, porque o ambiente desta sessão está explicitamente
restrito a desenvolver e enviar (push) apenas para
`claude/blissful-edison-4wt18p`, nunca para outra branch, sem
autorização explícita do usuário. A execução da fusão está deixada para
o usuário decidir (ver "Como proceder" no final).

## Branch que continha o SaaS

`claude/blissful-edison-4wt18p` — contém, sozinha, 100% do código do
Aureon Agenda: todo o diretório `web/` (app Next.js, migrations do
Supabase, documentação, os 12 documentos de auditoria produzidos até
agora), a partir do commit `2bf1d05` ("Add Aureon Agenda: multi-tenant
scheduling SaaS in web/", 2026-09-24) até o HEAD atual desta sessão.

## Branch `main` antes desta correção

`main` apontava para `51f0e40` ("Update server.js", 2026-08-25) — o
mesmo commit onde as duas branches divergem. `main` **nunca recebeu
nenhum commit novo** desde então; seu conteúdo é inteiramente o projeto
não relacionado "TraderAureonia" (`README.md`, `package.json`,
`server.js`, `TraderAureonia_Slave.mq5` — um servidor de sinais de
trading via WhatsApp, ver `web/README.md` para a nota explícita sobre
essa separação). Nenhuma linha do Aureon Agenda existia em `main`.

## Investigação: main tem código antigo do mesmo produto, ou outro produto?

**Outro produto inteiramente.** Confirmado por leitura direta:
`git ls-tree main --name-only` retorna só os 4 arquivos do
TraderAureonia — nenhum diretório `web/`, nenhuma migration, nada do
Aureon Agenda em nenhuma versão, antiga ou nova. Não há necessidade de
reconciliar duas versões do mesmo produto: são projetos disjuntos que
sempre coexistiram no mesmo repositório.

## Verificação de sobreposição de arquivos (antes de propor qualquer fusão)

```
git diff --name-only main claude/blissful-edison-4wt18p -- . ':!web'
```

retorna **vazio** — nenhum arquivo fora de `web/` difere entre as duas
branches. Os 4 arquivos do TraderAureonia são **idênticos** nas duas
branches (a branch de trabalho nunca os tocou). E:

```
comm -23 <(git ls-tree -r main --name-only | sort) \
         <(git ls-tree -r claude/blissful-edison-4wt18p --name-only | sort)
```

retorna **vazio** — todo arquivo que existe em `main` também existe,
sem diferença, na branch de trabalho. Ou seja, **a branch de trabalho é
um superconjunto estrito de `main`**: tudo que está em `main` já está
lá, mais o diretório `web/` inteiro por cima.

## Relação de histórico

```
git merge-base --is-ancestor main claude/blissful-edison-4wt18p
```

retorna verdadeiro: **`main` é um ancestral direto da branch de
trabalho.** Isso significa que a atualização de `main` para o estado
atual do produto é um **fast-forward puro** — não é um merge no sentido
de precisar combinar duas histórias divergentes, não gera nenhum commit
de merge, não descarta nenhum commit de `main` (porque não existe
nenhum commit em `main` que não esteja já contido na branch de
trabalho), e não pode gerar nenhum conflito (os conjuntos de arquivos
tocados por cada lado nunca se sobrepõem).

## Estratégia recomendada

**Fast-forward de `main` para o commit atual de
`claude/blissful-edison-4wt18p`** — o equivalente a:

```bash
git checkout main
git merge --ff-only claude/blissful-edison-4wt18p
git push origin main
```

Isso preserva 100% do histórico de ambas as branches (nada é
reescrito, nada é descartado, nenhum commit muda de hash), é
tecnicamente equivalente a "main passa a apontar para onde a branch de
trabalho já aponta", e não requer `cherry-pick` (não há nenhum commit
isolado de `main` que precise ser transportado — não existe nenhum
commit em `main` ausente da branch de trabalho) nem resolução de
conflito (nenhum arquivo é tocado pelos dois lados).

Nenhuma das proibições da tarefa se aplica a esta estratégia: não é
`reset --hard`, não é `force push` (um fast-forward nunca precisa de
`--force`), não reescreve commits, não apaga histórico, não apaga
nenhuma branch.

## Por que isso não foi executado nesta sessão

O ambiente de execução desta sessão foi explicitamente configurado para
desenvolver **somente** na branch `claude/blissful-edison-4wt18p`, com
a regra "nunca fazer push para uma branch diferente sem permissão
explícita do usuário". Colocar `main` em dia é uma ação que afeta o
branch de produção/oficial do repositório — mesmo sendo tecnicamente
segura (fast-forward, zero risco de perda de dados), é o tipo de ação
que deve ser confirmada explicitamente antes de ser executada, não
assumida.

## Como proceder

Se o usuário confirmar que deseja que `main` passe a refletir o estado
atual do produto, a próxima mensagem desta sessão (ou uma nova) pode
executar exatamente os três comandos acima, ou o usuário pode abrir uma
pull request de `claude/blissful-edison-4wt18p` para `main` no GitHub
(que o próprio GitHub também resolverá como fast-forward, sem
conflitos) e mesclá-la pela interface.

## Como verificar, depois disso, que `main` e a branch de trabalho contêm o mesmo produto

```bash
git rev-parse main
git rev-parse claude/blissful-edison-4wt18p
# devem imprimir o mesmo hash de commit após o fast-forward

git diff main claude/blissful-edison-4wt18p
# deve retornar vazio -- nenhuma diferença de conteúdo

git ls-tree -r main --name-only | grep -c "^web/"
# deve ser igual ao número de arquivos em web/ na branch de trabalho
```

## Estado final (no momento da escrita deste documento)

`main` **ainda não foi alterado** — continua em `51f0e40`, contendo
apenas o TraderAureonia. A branch `claude/blissful-edison-4wt18p`
continua sendo a única fonte de verdade do Aureon Agenda até que a
fusão acima seja executada com autorização explícita.
