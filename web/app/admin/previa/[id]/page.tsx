import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase';
import type { Barbearia } from '@/lib/barbearia';
import { PreviaAoVivo } from './PreviaAoVivo';

export const metadata: Metadata = { title: 'Pré-visualização', robots: { index: false } };

/** Página carregada dentro do iframe do editor de tema (superadmin; funciona mesmo com a barbearia inativa). */
export default async function Previa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServidor();
  const [{ data: b }, { data: servicos }, { data: profissionais }] = await Promise.all([
    sb.from('barbearias').select('id, slug, nome, whatsapp, endereco, cidade, instagram, horario_funcionamento, tema').eq('id', id).maybeSingle(),
    sb.from('servicos').select('id, nome, descricao, preco, duracao_min').eq('barbearia_id', id).eq('ativo', true).order('ordem').order('nome'),
    sb.from('profissionais').select('id, nome, foto_url').eq('barbearia_id', id).eq('ativo', true).order('ordem').order('nome'),
  ]);
  if (!b) notFound();
  const barbearia = { ...b, servicos: servicos ?? [], profissionais: profissionais ?? [] } as Barbearia;
  return <PreviaAoVivo inicial={barbearia} />;
}
