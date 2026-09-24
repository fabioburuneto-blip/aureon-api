'use server';

import { revalidatePath } from 'next/cache';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { HorarioLivre } from '@/lib/agendamento';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Horários livres (mesma regra do site: disponibilidade, bloqueios, agendamentos, duração). */
export async function horariosDoDia(
  servicoId: string,
  profissionalId: string,
  dia: string,
): Promise<{ ok: true; horarios: HorarioLivre[] } | { ok: false; erro: string }> {
  const { barbearia } = await exigirPainel();
  if (!UUID.test(servicoId) || !UUID.test(profissionalId) || !DIA.test(dia)) return { ok: false, erro: 'Dados inválidos.' };
  if (!barbearia.ativo) return { ok: false, erro: 'A barbearia está inativa. Fale com o suporte para reativar.' };
  const sb = await supabaseServidor();
  const { data, error } = await sb.rpc('horarios_livres', {
    p_slug: barbearia.slug,
    p_servico_id: servicoId,
    p_profissional_id: profissionalId,
    p_data: dia,
  });
  if (error) return { ok: false, erro: error.code === 'P0002' ? error.message : 'Não foi possível carregar os horários.' };
  return { ok: true, horarios: (data ?? []) as HorarioLivre[] };
}

/** Procura cliente já cadastrado pelo telefone (para preencher o nome). */
export async function buscarCliente(telefone: string): Promise<{ nome: string; visitas: number } | null> {
  await exigirPainel();
  const d = telefone.replace(/\D/g, '');
  if (d.length < 10) return null;
  const sb = await supabaseServidor();
  const { data } = await sb.from('clientes_resumo').select('nome, visitas').in('telefone', [d, `55${d}`]).limit(1).maybeSingle();
  return data ? { nome: data.nome, visitas: Number(data.visitas) } : null;
}

export async function criarAgendamentoManual(entrada: {
  servicoId: string;
  profissionalId: string;
  inicio: string;
  nome: string;
  telefone: string;
  observacao: string;
}): Promise<{ ok: true; dia: string } | { ok: false; erro: string; horarioOcupado?: boolean }> {
  const { barbearia } = await exigirPainel();
  const nome = entrada.nome.trim().slice(0, 100);
  const telefone = entrada.telefone.replace(/\D/g, '');
  const observacao = entrada.observacao.trim().slice(0, 500) || null;
  if (!UUID.test(entrada.servicoId) || !UUID.test(entrada.profissionalId) || Number.isNaN(Date.parse(entrada.inicio))) {
    return { ok: false, erro: 'Dados inválidos.' };
  }
  if (nome.length < 2) return { ok: false, erro: 'Informe o nome do cliente.' };
  if (telefone.length < 10 || telefone.length > 11) return { ok: false, erro: 'Telefone inválido. Use DDD + número.' };

  const sb = await supabaseServidor();
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(entrada.inicio));

  // 1. o horário continua livre para esse profissional?
  const livres = await sb.rpc('horarios_livres', {
    p_slug: barbearia.slug,
    p_servico_id: entrada.servicoId,
    p_profissional_id: entrada.profissionalId,
    p_data: dia,
  });
  const aindaLivre = ((livres.data ?? []) as HorarioLivre[]).some((h) => Date.parse(h.inicio) === Date.parse(entrada.inicio));
  if (!aindaLivre) return { ok: false, erro: 'Esse horário não está mais livre. Escolha outro.', horarioOcupado: true };

  // 2. cliente: cria ou reaproveita pelo telefone (atualiza o nome digitado pela equipe)
  const { data: cliente, error: erroCliente } = await sb
    .from('clientes')
    .upsert({ barbearia_id: barbearia.id, nome, telefone }, { onConflict: 'barbearia_id,telefone' })
    .select('id')
    .single();
  if (erroCliente || !cliente) return { ok: false, erro: 'Não foi possível salvar o cliente.' };

  // 3. agendamento (fim e preço vêm do serviço; a exclusion constraint impede sobreposição)
  const { error } = await sb.from('agendamentos').insert({
    barbearia_id: barbearia.id,
    profissional_id: entrada.profissionalId,
    servico_id: entrada.servicoId,
    cliente_id: cliente.id,
    inicio: entrada.inicio,
    origem: 'manual',
    status: 'confirmado',
    observacao,
  });
  if (error) {
    if (error.code === '23P01') return { ok: false, erro: 'Esse horário acabou de ser ocupado. Escolha outro.', horarioOcupado: true };
    return { ok: false, erro: 'Não foi possível criar o agendamento.' };
  }
  revalidatePath('/painel');
  revalidatePath('/painel/clientes');
  return { ok: true, dia };
}
