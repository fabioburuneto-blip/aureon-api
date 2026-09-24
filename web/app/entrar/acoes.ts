'use server';

import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase';
import { destinoDoPapel, type Papel } from '@/lib/sessao';

export type EstadoEntrar = { erro: string | null; email: string };

export async function entrar(_: EstadoEntrar, dados: FormData): Promise<EstadoEntrar> {
  const email = String(dados.get('email') ?? '').trim().toLowerCase();
  const senha = String(dados.get('senha') ?? '');
  const proximo = String(dados.get('proximo') ?? '');
  if (!email || !senha) return { erro: 'Informe e-mail e senha.', email };

  const sb = await supabaseServidor();
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) {
    const msg = error?.message?.toLowerCase().includes('invalid') ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar agora. Tente de novo.';
    return { erro: msg, email };
  }

  const { data: perfil } = await sb.from('perfis').select('papel, barbearia_id').eq('id', data.user.id).maybeSingle();
  if (!perfil || (perfil.papel !== 'superadmin' && !perfil.barbearia_id)) {
    await sb.auth.signOut();
    return { erro: 'Seu usuário ainda não tem acesso configurado. Fale com o suporte.', email };
  }

  const destino = destinoDoPapel(perfil.papel as Papel);
  // só respeita "proximo" se for da área do próprio papel (evita redirecionamento aberto)
  redirect(proximo.startsWith(`${destino}/`) || proximo === destino ? proximo : destino);
}

export async function sair() {
  const sb = await supabaseServidor();
  await sb.auth.signOut();
  redirect('/entrar');
}
