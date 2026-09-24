import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirDono } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { ProfissionalPainel } from '@/lib/painel-tipos';
import { IEsquerda } from '@/components/interno/Icones';
import { EditorProfissional } from './EditorProfissional';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Profissional' };

export default async function PaginaProfissional({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ novo?: string }>;
}) {
  const { barbearia } = await exigirDono();
  const { id } = await params;
  const { novo } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServidor();
  const [prof, disp] = await Promise.all([
    sb.from('profissionais').select('id, nome, foto_url, ativo, ordem').eq('id', id).eq('barbearia_id', barbearia.id).maybeSingle(),
    sb.from('disponibilidade').select('dia_semana, hora_inicio, hora_fim').eq('profissional_id', id).order('dia_semana').order('hora_inicio'),
  ]);
  if (!prof.data) notFound();

  return (
    <>
      <Link href="/painel/profissionais" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`} style={{ marginLeft: -12 }}>
        <IEsquerda tamanho={18} /> Equipe
      </Link>
      <EditorProfissional
        barbeariaId={barbearia.id}
        profissional={prof.data as ProfissionalPainel}
        horarios={(disp.data ?? []).map((d) => ({ dia_semana: d.dia_semana, hora_inicio: d.hora_inicio.slice(0, 5), hora_fim: d.hora_fim.slice(0, 5) }))}
        novo={novo === '1'}
      />
    </>
  );
}
