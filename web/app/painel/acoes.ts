'use server';

import { revalidatePath } from 'next/cache';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { Resultado, Status } from '@/lib/painel-tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Status[] = ['confirmado', 'concluido', 'cancelado', 'faltou'];

/** Concluído / Faltou / Cancelar (ou reabrir como confirmado). O RLS garante que é da barbearia. */
export async function alterarStatus(id: string, status: Status): Promise<Resultado> {
  await exigirPainel();
  if (!UUID.test(id) || !STATUS.includes(status)) return { ok: false, erro: 'Dados inválidos.' };
  const sb = await supabaseServidor();
  const { data, error } = await sb.from('agendamentos').update({ status }).eq('id', id).select('id');
  if (error) {
    if (error.code === '23P01') return { ok: false, erro: 'Esse horário já foi ocupado por outro agendamento.' };
    return { ok: false, erro: 'Não foi possível atualizar. Tente de novo.' };
  }
  if (!data?.length) return { ok: false, erro: 'Agendamento não encontrado.' };
  revalidatePath('/painel');
  revalidatePath('/painel/clientes');
  return { ok: true };
}
