'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { exigirSuperadmin } from '@/lib/sessao';
import { supabaseAdmin, supabaseServidor } from '@/lib/supabase';
import { validarSlug } from '@/lib/slug';
import { validarTema } from '@/lib/tema-validacao';
import type { Tema } from '@/lib/barbearia';
import type { Resultado } from '@/lib/painel-tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DadosBarbearia = {
  nome: string;
  slug: string;
  whatsapp: string;
  endereco: string;
  cidade: string;
  instagram: string;
};

function limpar(d: DadosBarbearia) {
  const nome = d.nome.trim().slice(0, 80);
  const slug = d.slug.trim().toLowerCase();
  const whatsapp = d.whatsapp.replace(/\D/g, '').slice(0, 13);
  return {
    nome,
    slug,
    whatsapp: whatsapp || null,
    endereco: d.endereco.trim().slice(0, 160) || null,
    cidade: d.cidade.trim().slice(0, 80) || null,
    instagram: d.instagram.trim().replace(/^@/, '').slice(0, 60) || null,
  };
}

function validarDados(v: ReturnType<typeof limpar>): string | null {
  if (v.nome.length < 2) return 'Informe o nome da barbearia.';
  const e = validarSlug(v.slug);
  if (e) return `Endereço: ${e}`;
  if (v.whatsapp && (v.whatsapp.length < 10 || v.whatsapp.length > 13)) return 'WhatsApp inválido (DDD + número).';
  return null;
}

/** Disponibilidade do slug em tempo real (ignora a própria barbearia ao editar). */
export async function verificarSlug(slug: string, ignorarId?: string): Promise<{ ok: boolean; mensagem: string }> {
  await exigirSuperadmin();
  const s = slug.trim().toLowerCase();
  const e = validarSlug(s);
  if (e) return { ok: false, mensagem: e };
  const sb = await supabaseServidor();
  let q = sb.from('barbearias').select('id').eq('slug', s);
  if (ignorarId && UUID.test(ignorarId)) q = q.neq('id', ignorarId);
  const { data } = await q.limit(1);
  return data?.length ? { ok: false, mensagem: 'Esse endereço já está em uso.' } : { ok: true, mensagem: 'Disponível' };
}

export async function criarBarbearia(d: DadosBarbearia): Promise<Resultado> {
  await exigirSuperadmin();
  const v = limpar(d);
  const erro = validarDados(v);
  if (erro) return { ok: false, erro };
  const sb = await supabaseServidor();
  const { data, error } = await sb.from('barbearias').insert(v).select('id').single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, erro: 'Esse endereço já está em uso.' };
    return { ok: false, erro: 'Não foi possível criar a barbearia.' };
  }
  revalidatePath('/admin');
  redirect(`/admin/barbearias/${data.id}?criada=1`);
}

export async function salvarDadosBarbearia(id: string, d: DadosBarbearia): Promise<Resultado> {
  await exigirSuperadmin();
  if (!UUID.test(id)) return { ok: false, erro: 'Barbearia inválida.' };
  const v = limpar(d);
  const erro = validarDados(v);
  if (erro) return { ok: false, erro };
  const sb = await supabaseServidor();
  const { data: antes } = await sb.from('barbearias').select('slug').eq('id', id).single();
  const { error } = await sb.from('barbearias').update(v).eq('id', id);
  if (error) return { ok: false, erro: error.code === '23505' ? 'Esse endereço já está em uso.' : 'Não foi possível salvar.' };
  revalidatePath('/admin');
  revalidatePath(`/admin/barbearias/${id}`);
  if (antes?.slug) revalidatePath(`/${antes.slug}`);
  revalidatePath(`/${v.slug}`);
  return { ok: true };
}

export async function alternarBarbearia(id: string, ativo: boolean): Promise<Resultado> {
  await exigirSuperadmin();
  if (!UUID.test(id)) return { ok: false, erro: 'Barbearia inválida.' };
  const sb = await supabaseServidor();
  const { data, error } = await sb.from('barbearias').update({ ativo }).eq('id', id).select('slug').single();
  if (error || !data) return { ok: false, erro: 'Não foi possível alterar.' };
  revalidatePath('/admin');
  revalidatePath(`/${data.slug}`);
  return { ok: true };
}

export async function salvarTema(id: string, tema: Tema): Promise<Resultado> {
  await exigirSuperadmin();
  if (!UUID.test(id)) return { ok: false, erro: 'Barbearia inválida.' };
  const r = validarTema(tema, id);
  if (!r.ok) return { ok: false, erro: r.erro };
  const sb = await supabaseServidor();
  const { data, error } = await sb.from('barbearias').update({ tema: r.tema }).eq('id', id).select('slug').single();
  if (error || !data) return { ok: false, erro: 'Não foi possível salvar o tema.' };
  revalidatePath(`/${data.slug}`);
  revalidatePath(`/${data.slug}/agendar`);
  revalidatePath(`/admin/barbearias/${id}`);
  return { ok: true };
}

export async function criarUsuario(
  barbeariaId: string,
  d: { nome: string; email: string; senha: string; papel: 'dono' | 'barbeiro' },
): Promise<Resultado> {
  await exigirSuperadmin();
  if (!UUID.test(barbeariaId)) return { ok: false, erro: 'Barbearia inválida.' };
  const nome = d.nome.trim().slice(0, 80);
  const email = d.email.trim().toLowerCase();
  if (nome.length < 2) return { ok: false, erro: 'Informe o nome.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erro: 'E-mail inválido.' };
  if (d.senha.length < 8) return { ok: false, erro: 'A senha provisória deve ter pelo menos 8 caracteres.' };
  if (!['dono', 'barbeiro'].includes(d.papel)) return { ok: false, erro: 'Papel inválido.' };

  let admin;
  try {
    admin = supabaseAdmin();
  } catch {
    return { ok: false, erro: 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para criar usuários.' };
  }

  const { data: criado, error } = await admin.auth.admin.createUser({
    email,
    password: d.senha,
    email_confirm: true,
    user_metadata: { nome },
  });
  if (error || !criado.user) {
    const jaExiste = /already|registered|exists/i.test(error?.message ?? '');
    return { ok: false, erro: jaExiste ? 'Já existe um usuário com esse e-mail.' : 'Não foi possível criar o usuário.' };
  }

  // perfil vinculado à barbearia (via sessão do superadmin: passa pelo RLS)
  const sb = await supabaseServidor();
  const { error: erroPerfil } = await sb.from('perfis').insert({ id: criado.user.id, barbearia_id: barbeariaId, nome, papel: d.papel });
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(criado.user.id); // não deixa usuário órfão
    return { ok: false, erro: 'Não foi possível vincular o usuário à barbearia.' };
  }
  revalidatePath(`/admin/barbearias/${barbeariaId}`);
  return { ok: true, mensagem: `Usuário ${email} criado` };
}
