import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase';
import type { Tema } from '@/lib/barbearia';
import { EditorTema } from './EditorTema';

export const metadata: Metadata = { title: 'Editor de tema' };

export default async function PaginaTema({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServidor();
  const { data: b } = await sb.from('barbearias').select('id, slug, nome, tema').eq('id', id).maybeSingle();
  if (!b) notFound();
  return <EditorTema id={b.id} slug={b.slug} nome={b.nome} temaSalvo={b.tema as Tema} />;
}
