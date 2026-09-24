import type { Metadata } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { ServicoPainel } from '@/lib/painel-tipos';
import { Servicos } from './Servicos';

export const metadata: Metadata = { title: 'Serviços' };

export default async function PaginaServicos() {
  const { barbearia } = await exigirPainel();
  const sb = await supabaseServidor();
  const [servicos, catalogo] = await Promise.all([
    sb.from('servicos').select('id, nome, descricao, preco, duracao_min, ativo, ordem').eq('barbearia_id', barbearia.id).order('ordem').order('nome'),
    sb.from('catalogo_servicos_padrao').select('nome, duracao_min_sugerida').order('duracao_min_sugerida').order('nome'),
  ]);
  return (
    <Servicos
      servicos={(servicos.data ?? []) as ServicoPainel[]}
      catalogo={(catalogo.data ?? []) as { nome: string; duracao_min_sugerida: number }[]}
    />
  );
}
