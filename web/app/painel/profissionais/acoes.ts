'use server';

import { revalidatePath } from 'next/cache';
import { exigirDono } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { Resultado } from '@/lib/painel-tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Só aceita fotos do próprio bucket da barbearia (enviadas pelo painel). */
function fotoValida(url: string | null, barbeariaId: string) {
  if (!url) return true;
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/barbearias/${barbeariaId}/`;
  return url.startsWith(base) && url.length < 500;
}

function atualizar(slug: string, id?: string) {
  revalidatePath('/painel/profissionais');
  if (id) revalidatePath(`/painel/profissionais/${id}`);
  revalidatePath('/painel');
  revalidatePath(`/${slug}`);
}

export async function criarProfissional(nome: string, fotoUrl: string | null): Promise<Resultado & { id?: string }> {
  const { barbearia } = await exigirDono();
  const n = nome.trim();
  if (n.length < 2 || n.length > 80) return { ok: false, erro: 'Informe o nome (2 a 80 caracteres).' };
  if (!fotoValida(fotoUrl, barbearia.id)) return { ok: false, erro: 'Foto inválida.' };
  const sb = await supabaseServidor();
  const { data: ultimo } = await sb.from('profissionais').select('ordem').eq('barbearia_id', barbearia.id).order('ordem', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await sb
    .from('profissionais')
    .insert({ barbearia_id: barbearia.id, nome: n, foto_url: fotoUrl, ordem: (ultimo?.ordem ?? 0) + 1 })
    .select('id')
    .single();
  if (error || !data) return { ok: false, erro: 'Não foi possível cadastrar.' };
  atualizar(barbearia.slug);
  return { ok: true, id: data.id };
}

export async function atualizarProfissional(id: string, dados: { nome: string; foto_url: string | null; ativo: boolean }): Promise<Resultado> {
  const { barbearia } = await exigirDono();
  if (!UUID.test(id)) return { ok: false, erro: 'Profissional inválido.' };
  const n = dados.nome.trim();
  if (n.length < 2 || n.length > 80) return { ok: false, erro: 'Informe o nome (2 a 80 caracteres).' };
  if (!fotoValida(dados.foto_url, barbearia.id)) return { ok: false, erro: 'Foto inválida.' };
  const sb = await supabaseServidor();
  const { data, error } = await sb
    .from('profissionais')
    .update({ nome: n, foto_url: dados.foto_url, ativo: !!dados.ativo })
    .eq('id', id)
    .eq('barbearia_id', barbearia.id)
    .select('id');
  if (error || !data?.length) return { ok: false, erro: 'Não foi possível salvar.' };
  atualizar(barbearia.slug, id);
  return { ok: true };
}

export type Intervalo = { dia_semana: number; hora_inicio: string; hora_fim: string };

export async function salvarHorarios(id: string, itens: Intervalo[]): Promise<Resultado> {
  const { barbearia } = await exigirDono();
  if (!UUID.test(id) || !Array.isArray(itens) || itens.length > 50) return { ok: false, erro: 'Dados inválidos.' };
  for (const i of itens) {
    if (!Number.isInteger(i.dia_semana) || i.dia_semana < 0 || i.dia_semana > 6) return { ok: false, erro: 'Dia inválido.' };
    if (!HORA.test(i.hora_inicio) || !HORA.test(i.hora_fim)) return { ok: false, erro: 'Horário inválido.' };
    if (i.hora_fim <= i.hora_inicio) return { ok: false, erro: 'O fim de cada intervalo deve ser depois do início.' };
  }
  const sb = await supabaseServidor();
  const { error } = await sb.rpc('salvar_disponibilidade', { p_profissional_id: id, p_itens: itens });
  if (error) return { ok: false, erro: error.code === '22023' ? error.message : 'Não foi possível salvar os horários.' };
  atualizar(barbearia.slug, id);
  return { ok: true };
}

export async function criarBloqueio(d: {
  profissional_id: string | null;
  inicio: string;
  fim: string;
  motivo: string;
}): Promise<Resultado> {
  const { barbearia } = await exigirDono();
  if (d.profissional_id && !UUID.test(d.profissional_id)) return { ok: false, erro: 'Profissional inválido.' };
  const ini = Date.parse(d.inicio);
  const fim = Date.parse(d.fim);
  if (Number.isNaN(ini) || Number.isNaN(fim)) return { ok: false, erro: 'Informe início e fim.' };
  if (fim <= ini) return { ok: false, erro: 'O fim deve ser depois do início.' };
  if (fim - ini > 1000 * 60 * 60 * 24 * 120) return { ok: false, erro: 'Período muito longo (máximo de 120 dias).' };
  const motivo = d.motivo.trim().slice(0, 80) || null;

  const sb = await supabaseServidor();
  const { error } = await sb.from('bloqueios').insert({
    barbearia_id: barbearia.id,
    profissional_id: d.profissional_id,
    inicio: new Date(ini).toISOString(),
    fim: new Date(fim).toISOString(),
    motivo,
  });
  if (error) return { ok: false, erro: 'Não foi possível criar o bloqueio.' };

  // avisa se já existem agendamentos nesse período (não são cancelados automaticamente)
  let q = sb
    .from('agendamentos')
    .select('id', { count: 'exact', head: true })
    .eq('barbearia_id', barbearia.id)
    .eq('status', 'confirmado')
    .lt('inicio', new Date(fim).toISOString())
    .gt('fim', new Date(ini).toISOString());
  if (d.profissional_id) q = q.eq('profissional_id', d.profissional_id);
  const { count } = await q;
  atualizar(barbearia.slug);
  return {
    ok: true,
    mensagem: count
      ? `Bloqueio criado. Atenção: ${count} ${count === 1 ? 'agendamento já marcado continua' : 'agendamentos já marcados continuam'} nesse período.`
      : 'Bloqueio criado',
  };
}

export async function removerBloqueio(id: string): Promise<Resultado> {
  const { barbearia } = await exigirDono();
  if (!UUID.test(id)) return { ok: false, erro: 'Bloqueio inválido.' };
  const sb = await supabaseServidor();
  const { error } = await sb.from('bloqueios').delete().eq('id', id).eq('barbearia_id', barbearia.id);
  if (error) return { ok: false, erro: 'Não foi possível remover.' };
  atualizar(barbearia.slug);
  return { ok: true };
}
