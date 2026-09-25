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

`SUPABASE_SERVICE_ROLE_KEY` é necessária para rodar o app completo:
usada pelo webhook de billing e pelo provedor de billing local (nunca
pelo navegador) — ver [`SECURITY.md`](./SECURITY.md#segredos) para os
três pontos exatos que a leem. Deixe em branco em dev se você não for
mexer em billing; o resto do app funciona sem ela.

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
for f in supabase/migrations/*.sql; do
  psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f "$f"
done
```

(em ordem alfabética/numérica — os nomes dos arquivos já garantem isso.)

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

### Dados de exemplo (opcional)

Para não começar com um dashboard vazio, `supabase/seed/demo.sql` cria uma
empresa de demonstração completa (serviços, profissionais, horários,
página pública publicada):

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
  -f supabase/seed/demo.sql
```

Seguro rodar mais de uma vez (idempotente). **Nunca** rode isto contra um
projeto de produção — ver o cabeçalho do próprio arquivo e
[`DEPLOY.md`](./DEPLOY.md#1-supabase-projeto-de-produção).

## 7. Testes e qualidade

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 8. Deploy em produção

Guia completo (GitHub → Vercel → Supabase, incluindo domínio e
observabilidade) em [`DEPLOY.md`](./DEPLOY.md).

## Regenerar tipos TypeScript do banco (opcional)

```bash
supabase gen types typescript --project-id SEU-PROJECT-REF > src/types/database.ts
```
