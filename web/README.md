# Site público das barbearias (Next.js)

Cada barbearia tem seu site em `/<slug>` (ex.: `/neguin`). Um único código atende todas:
todo o visual vem do campo `tema` salvo no Supabase.

## Rodando

```bash
cd web
cp .env.example .env.local   # preencha URL e anon key do Supabase
npm install
npm run dev                  # http://localhost:3000/demo
```

Antes, aplique as migrations e o seed (`../supabase/README.md`). O seed cria as barbearias de exemplo:

| URL | Layout | Fontes |
|---|---|---|
| `/demo` | luxo | elegante (Playfair Display + Inter) |
| `/demo-classico` | classico | classica (Cinzel + Lato) |
| `/demo-urbano` | urbano | impacto (Bebas Neue + Roboto) |
| `/demo-minimalista` | minimalista | moderna (Space Grotesk + Inter) |

Para trocar o layout da `/demo` sem mexer no resto:

```sql
update barbearias set tema = tema || '{"layout": "urbano", "par_fontes": "impacto"}' where slug = 'demo';
```

As imagens da demo são ilustrações fictícias em `public/demo/`. Em produção, as barbearias enviam as
suas para o bucket `barbearias` do Supabase Storage e salvam a URL pública no `tema`.

## Como funciona

- **Dados**: `lib/barbearia.ts` chama a RPC `barbearia_publica(slug)` no servidor. Se o slug não
  existir ou a barbearia estiver inativa, a resposta é **404** com a página "Barbearia não encontrada".
- **Tema → CSS**: `lib/tema.ts` transforma as cores em `--primaria`, `--destaque`, `--fundo` e
  `--texto` e aplica na raiz do site. As variáveis derivadas (`--sobre-destaque`, `--sobre-primaria`,
  `--primaria-legivel`) escolhem, entre as próprias cores do tema, a mais legível sobre cada fundo.
  Cores que não sejam `#hex` são ignoradas.
- **Fontes**: `par_fontes` define qual par é carregado do Google Fonts (só o par usado).
- **Layouts**: `components/layouts/{Classico,Urbano,Luxo,Minimalista}.tsx`, cada um com seu CSS
  Module. Todos têm as mesmas seções na mesma ordem:
  hero → serviços → equipe → sobre → galeria → contato.
  - A equipe só aparece com 2 ou mais profissionais ativos.
  - A galeria só aparece se houver fotos.
  - O sobre só aparece se houver texto.
- **Mobile first**: botão "Agendar horário" fixo no rodapé abaixo de 900px.
- **Compartilhamento**: `generateMetadata` gera `<title>`, `og:title`, `og:description` e
  `og:image` (logo; sem logo, usa a foto de capa), além do favicon e do `theme-color`. O robô do
  WhatsApp recebe as meta tags já no HTML inicial.
  Defina `NEXT_PUBLIC_SITE_URL` em produção para o `og:image` sair com o domínio correto.
- **`/<slug>/agendar`**: agendamento online, sem login e sem cadastro, seguindo o tema da barbearia
  (veja abaixo).

## Agendamento online (`/<slug>/agendar`)

Um passo por tela, com barra de progresso e botão voltar (o "voltar" do celular também funciona):

1. **Serviço**: nome, descrição, duração e preço.
2. **Profissional** ou "Qualquer profissional". O passo é pulado quando só há 1 profissional ativo.
3. **Data e horário**: faixa com os próximos 30 dias (RPC `dias_disponiveis`); dias sem vaga
   ficam desabilitados. Os horários do dia (RPC `horarios_livres`) aparecem agrupados em
   manhã, tarde e noite.
4. **Nome e WhatsApp**, com máscara brasileira. Fica salvo neste aparelho para a próxima vez.
5. **Revisão**. Ao abrir, confere de novo se o horário continua livre; ao confirmar, chama
   `criar_agendamento_publico`.
6. **Sucesso**: resumo, "Adicionar ao Google Agenda" e "Falar no WhatsApp", com mensagem pronta.

Se o horário for ocupado por outra pessoa no meio do processo, o cliente volta para a escolha de
horário com um aviso, e a lista é recarregada sem aquele horário. Os demais erros (ex.: limite de
agendamentos por telefone) aparecem na revisão, com um link para o WhatsApp da barbearia.

As chamadas ao banco passam por Server Actions (`app/[slug]/agendar/acoes.ts`), que validam a
entrada e usam só as RPCs públicas. Datas e horas são sempre exibidas no fuso America/Sao_Paulo,
independentemente do fuso do celular.

## Observações

- Rotas fixas que forem criadas no futuro (ex.: `/admin`, `/login`) têm prioridade sobre um slug
  de mesmo nome. Evite cadastrar barbearias com esses slugs.
- Deploy na Vercel: defina o *Root Directory* como `web` e configure as 3 variáveis do `.env.example`.
