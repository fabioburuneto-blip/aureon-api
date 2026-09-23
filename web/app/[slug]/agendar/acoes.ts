'use server';

import { SLUG_VALIDO } from '@/lib/barbearia';
import { supabasePublico } from '@/lib/supabase';
import type { Confirmacao, DiaDisponivel, ErroAgendamento, HorarioLivre } from '@/lib/agendamento';

// Server Actions do agendamento: validam a entrada e repassam para as RPCs públicas.

type Resultado<T> = { ok: true; dados: T } | { ok: false; mensagem: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const FALHA = 'Não foi possível carregar agora. Verifique sua conexão e tente de novo.';

function entradaValida(slug: string, servicoId: string, profissionalId: string | null) {
  return SLUG_VALIDO.test(slug) && UUID.test(servicoId) && (profissionalId === null || UUID.test(profissionalId));
}

export async function listarDias(
  slug: string,
  servicoId: string,
  profissionalId: string | null,
): Promise<Resultado<DiaDisponivel[]>> {
  if (!entradaValida(slug, servicoId, profissionalId)) return { ok: false, mensagem: 'Dados inválidos.' };
  const { data, error } = await supabasePublico().rpc('dias_disponiveis', {
    p_slug: slug,
    p_servico_id: servicoId,
    p_profissional_id: profissionalId,
    p_dias: 30,
  });
  if (error) {
    console.error('dias_disponiveis', error);
    return { ok: false, mensagem: error.code === 'P0002' ? error.message : FALHA };
  }
  return { ok: true, dados: (data ?? []) as DiaDisponivel[] };
}

export async function listarHorarios(
  slug: string,
  servicoId: string,
  profissionalId: string | null,
  data: string,
): Promise<Resultado<HorarioLivre[]>> {
  if (!entradaValida(slug, servicoId, profissionalId) || !DATA.test(data)) {
    return { ok: false, mensagem: 'Dados inválidos.' };
  }
  const { data: linhas, error } = await supabasePublico().rpc('horarios_livres', {
    p_slug: slug,
    p_servico_id: servicoId,
    p_profissional_id: profissionalId,
    p_data: data,
  });
  if (error) {
    console.error('horarios_livres', error);
    return { ok: false, mensagem: error.code === 'P0002' ? error.message : FALHA };
  }
  return { ok: true, dados: (linhas ?? []) as HorarioLivre[] };
}

export async function confirmarAgendamento(entrada: {
  slug: string;
  servicoId: string;
  profissionalId: string | null;
  inicio: string;
  nome: string;
  telefone: string;
}): Promise<Confirmacao | ErroAgendamento> {
  const { slug, servicoId, profissionalId, inicio, nome, telefone } = entrada;
  if (!entradaValida(slug, servicoId, profissionalId) || Number.isNaN(Date.parse(inicio))) {
    return { ok: false, codigo: 'dados_invalidos', mensagem: 'Dados inválidos. Recomece o agendamento.' };
  }
  const { data, error } = await supabasePublico().rpc('criar_agendamento_publico', {
    p_slug: slug,
    p_servico_id: servicoId,
    p_profissional_id: profissionalId,
    p_inicio: inicio,
    p_nome_cliente: String(nome).slice(0, 100),
    p_telefone: String(telefone).slice(0, 20),
  });
  if (error || !data) {
    console.error('criar_agendamento_publico', error);
    return { ok: false, codigo: 'falha', mensagem: 'Não conseguimos confirmar agora. Tente de novo em instantes.' };
  }
  return data as Confirmacao | ErroAgendamento;
}
