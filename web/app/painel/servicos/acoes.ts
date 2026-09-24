'use server';

import { revalidatePath } from 'next/cache';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { Resultado } from '@/lib/painel-tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function atualizar(slug: string) {
  revalidatePath('/painel/servicos');
  revalidatePath(`/${slug}`); // site público mostra os serviços
}

type DadosServico = { id?: string; nome: string; descricao: string; preco: number; duracao_min: number };

function validar(d: DadosServico): string | null {
  if (!d.nome?.trim() || d.nome.trim().length > 80) return 'Informe o nome (até 80 caracteres).';
  if (!Number.isFinite(d.preco) || d.preco < 0 || d.preco > 100000) return 'Preço inválido.';
  if (!Number.isInteger(d.duracao_min) || d.duracao_min < 5 || d.duracao_min > 720) return 'Duração deve ser entre 5 e 720 minutos.';
  if ((d.descricao ?? '').length > 300) return 'Descrição muito longa (até 300 caracteres).';
  return null;
}

export async function salvarServico(d: DadosServico): Promise<Resultado> {
  const { barbearia } = await exigirPainel();
  const erro = validar(d);
  if (erro) return { ok: false, erro };
  const sb = await supabaseServidor();
  const campos = {
    nome: d.nome.trim(),
    descricao: d.descricao?.trim() || null,
    preco: Math.round(d.preco * 100) / 100,
    duracao_min: d.duracao_min,
  };

  if (d.id) {
    if (!UUID.test(d.id)) return { ok: false, erro: 'Serviço inválido.' };
    const { error } = await sb.from('servicos').update(campos).eq('id', d.id).eq('barbearia_id', barbearia.id);
    if (error) return { ok: false, erro: 'Não foi possível salvar.' };
  } else {
    const { data: ultimo } = await sb.from('servicos').select('ordem').eq('barbearia_id', barbearia.id).order('ordem', { ascending: false }).limit(1).maybeSingle();
    const { error } = await sb.from('servicos').insert({ ...campos, barbearia_id: barbearia.id, ordem: (ultimo?.ordem ?? 0) + 1 });
    if (error) return { ok: false, erro: 'Não foi possível criar o serviço.' };
  }
  atualizar(barbearia.slug);
  return { ok: true };
}

export async function alternarServico(id: string, ativo: boolean): Promise<Resultado> {
  const { barbearia } = await exigirPainel();
  if (!UUID.test(id)) return { ok: false, erro: 'Serviço inválido.' };
  const sb = await supabaseServidor();
  const { error } = await sb.from('servicos').update({ ativo }).eq('id', id).eq('barbearia_id', barbearia.id);
  if (error) return { ok: false, erro: 'Não foi possível alterar.' };
  atualizar(barbearia.slug);
  return { ok: true };
}

/** Grava a nova ordem (lista completa de ids na ordem desejada). */
export async function reordenarServicos(ids: string[]): Promise<Resultado> {
  const { barbearia } = await exigirPainel();
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => UUID.test(i))) return { ok: false, erro: 'Dados inválidos.' };
  const sb = await supabaseServidor();
  const resultados = await Promise.all(
    ids.map((id, i) => sb.from('servicos').update({ ordem: i + 1 }).eq('id', id).eq('barbearia_id', barbearia.id)),
  );
  if (resultados.some((r) => r.error)) return { ok: false, erro: 'Não foi possível reordenar.' };
  atualizar(barbearia.slug);
  return { ok: true };
}

/** Adiciona vários serviços do catálogo padrão de uma vez. */
export async function adicionarDoCatalogo(itens: { nome: string; duracao_min: number; preco: number }[]): Promise<Resultado> {
  const { barbearia } = await exigirPainel();
  if (!Array.isArray(itens) || !itens.length || itens.length > 50) return { ok: false, erro: 'Selecione ao menos um serviço.' };
  for (const it of itens) {
    const e = validar({ ...it, descricao: '' });
    if (e) return { ok: false, erro: `${it.nome || 'Serviço'}: ${e}` };
  }
  const sb = await supabaseServidor();
  const { data: ultimo } = await sb.from('servicos').select('ordem').eq('barbearia_id', barbearia.id).order('ordem', { ascending: false }).limit(1).maybeSingle();
  const base = ultimo?.ordem ?? 0;
  const { error } = await sb.from('servicos').insert(
    itens.map((it, i) => ({
      barbearia_id: barbearia.id,
      nome: it.nome.trim(),
      duracao_min: it.duracao_min,
      preco: Math.round(it.preco * 100) / 100,
      ordem: base + i + 1,
    })),
  );
  if (error) return { ok: false, erro: 'Não foi possível adicionar os serviços.' };
  atualizar(barbearia.slug);
  return { ok: true, mensagem: `${itens.length} ${itens.length === 1 ? 'serviço adicionado' : 'serviços adicionados'}` };
}
