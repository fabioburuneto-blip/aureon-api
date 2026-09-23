import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Renova a sessão do Supabase (cookies) nas áreas logadas e faz o redirecionamento
 * otimista para /entrar. A autorização de verdade (papel, barbearia) é feita nas
 * páginas e Server Actions, e o RLS do banco garante o isolamento.
 */
export async function proxy(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        resposta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const areaLogada = pathname.startsWith('/painel') || pathname.startsWith('/admin');
  if (areaLogada && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/entrar';
    url.search = `?proximo=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return resposta;
}

export const config = {
  matcher: ['/painel/:path*', '/admin/:path*', '/entrar'],
};
