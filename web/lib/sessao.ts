import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServidor } from './supabase';

export type Papel = 'superadmin' | 'dono' | 'barbeiro';

export type Sessao = {
  userId: string;
  email: string;
  nome: string;
  papel: Papel;
  barbeariaId: string | null;
};

export type BarbeariaPainel = {
  id: string;
  slug: string;
  nome: string;
  whatsapp: string | null;
  ativo: boolean;
  logo: string;
};

/** Usuário logado + perfil (null se não logado ou sem perfil). Deduplicado por requisição. */
export const obterSessao = cache(async (): Promise<Sessao | null> => {
  const sb = await supabaseServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb.from('perfis').select('nome, papel, barbearia_id').eq('id', user.id).maybeSingle();
  if (!perfil) return null;
  return {
    userId: user.id,
    email: user.email ?? '',
    nome: perfil.nome,
    papel: perfil.papel as Papel,
    barbeariaId: perfil.barbearia_id,
  };
});

export function destinoDoPapel(papel: Papel): string {
  return papel === 'superadmin' ? '/admin' : '/painel';
}

/** Painel: dono ou barbeiro com barbearia. Retorna sessão + barbearia. */
export const exigirPainel = cache(async (): Promise<{ sessao: Sessao; barbearia: BarbeariaPainel }> => {
  const sessao = await obterSessao();
  if (!sessao) redirect('/entrar');
  if (sessao.papel === 'superadmin') redirect('/admin');
  if (!sessao.barbeariaId) redirect('/entrar?erro=sem-barbearia');
  const sb = await supabaseServidor();
  const { data: b } = await sb
    .from('barbearias')
    .select('id, slug, nome, whatsapp, ativo, tema')
    .eq('id', sessao.barbeariaId)
    .single();
  if (!b) redirect('/entrar?erro=sem-barbearia');
  return {
    sessao,
    barbearia: { id: b.id, slug: b.slug, nome: b.nome, whatsapp: b.whatsapp, ativo: b.ativo, logo: b.tema?.logo_url ?? '' },
  };
});

export async function exigirDono() {
  const ctx = await exigirPainel();
  if (ctx.sessao.papel !== 'dono') redirect('/painel');
  return ctx;
}

export const exigirSuperadmin = cache(async (): Promise<Sessao> => {
  const sessao = await obterSessao();
  if (!sessao) redirect('/entrar');
  if (sessao.papel !== 'superadmin') redirect('/painel');
  return sessao;
});
