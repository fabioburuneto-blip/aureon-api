import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

function credenciais() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).');
  }
  return { url, key };
}

/** Cliente anônimo usado no servidor (site público e agendamento). */
export function supabasePublico() {
  const { url, key } = credenciais();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Cliente com a sessão do usuário logado (cookies). Todas as consultas passam pelo RLS
 * com a identidade dele: dono/barbeiro só enxergam a própria barbearia.
 */
export async function supabaseServidor() {
  const { url, key } = credenciais();
  const loja = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => loja.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => loja.set(name, value, options));
        } catch {
          // chamado de um Server Component: quem renova os cookies é o proxy.ts
        }
      },
    },
  });
}

/**
 * Cliente com a service_role (ignora RLS). Usar SOMENTE em ações do superadmin já
 * verificadas, para o que o RLS não cobre: criar usuários no Auth e ler e-mails.
 */
export function supabaseAdmin() {
  const { url } = credenciais();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY para criar usuários (veja .env.example).');
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}
