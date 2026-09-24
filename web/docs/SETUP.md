# Setup

## Pré-requisitos

- Node.js 20.9+ (exigido pelo Next.js 16)
- Uma conta [Supabase](https://supabase.com) (plano free é suficiente)
- Opcional: [Supabase CLI](https://supabase.com/docs/guides/cli) para
  rodar migrations com um comando

## 1. Instalar dependências

```bash
cd web
npm install
```

## 2. Criar o projeto Supabase

1. Crie um projeto em [supabase.com/dashboard](https://supabase.com/dashboard).
2. Em **Project Settings → API**, copie a **Project URL** e a
   **anon public key**.

## 3. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` só é necessária para scripts administrativos
fora do app — a aplicação em si nunca a utiliza.

## 4. Rodar as migrations

### Opção A — Supabase CLI (recomendado)

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase db push
```

Isso aplica, em ordem, todos os arquivos em `supabase/migrations/`.

### Opção B — `psql` direto

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -f supabase/migrations/20250924120001_extensions_and_helpers.sql \
  -f supabase/migrations/20250924120002_schema.sql \
  -f supabase/migrations/20250924120003_membership_functions.sql \
  -f supabase/migrations/20250924120004_rls.sql \
  -f supabase/migrations/20250924120005_functions.sql \
  -f supabase/migrations/20250924120006_storage.sql
```

Ou cole o conteúdo de cada arquivo, na mesma ordem numérica, no
**SQL Editor** do dashboard do Supabase.

## 5. Configurar redirect de autenticação

Em **Authentication → URL Configuration**, no dashboard do Supabase,
adicione:

- Site URL: `http://localhost:3000` (e depois a URL de produção)
- Redirect URLs: `http://localhost:3000/auth/confirm` (e o equivalente em
  produção)

## 6. Rodar localmente

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000), crie uma conta em
`/signup`, confirme o email (verifique o link no email enviado pelo
Supabase) e conclua o onboarding em `/onboarding`.

## 7. Testes e qualidade

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 8. Deploy na Vercel

1. [vercel.com/new](https://vercel.com/new) → importe o repositório.
2. **Root Directory**: `web`.
3. Adicione as mesmas variáveis de ambiente do passo 3 (para Production e
   Preview).
4. Deploy.
5. Atualize **Site URL** / **Redirect URLs** no Supabase com o domínio de
   produção (e o preview, se for usar).
6. As migrations do Supabase **não** rodam automaticamente no deploy da
   Vercel — aplique-as manualmente (passo 4) antes ou depois do primeiro
   deploy.

## Regenerar tipos TypeScript do banco (opcional)

```bash
supabase gen types typescript --project-id SEU-PROJECT-REF > src/types/database.ts
```
