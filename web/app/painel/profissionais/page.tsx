import type { Metadata } from 'next';
import { exigirDono } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { ProfissionalPainel } from '@/lib/painel-tipos';
import { Equipe, type Bloqueio } from './Equipe';

export const metadata: Metadata = { title: 'Equipe' };

export default async function PaginaEquipe() {
  const { barbearia } = await exigirDono();
  const sb = await supabaseServidor();
  const [profissionais, disponibilidade, bloqueios] = await Promise.all([
    sb.from('profissionais').select('id, nome, foto_url, ativo, ordem').eq('barbearia_id', barbearia.id).order('ordem').order('nome'),
    sb.from('disponibilidade').select('profissional_id, dia_semana').eq('barbearia_id', barbearia.id),
    sb
      .from('bloqueios')
      .select('id, profissional_id, inicio, fim, motivo')
      .eq('barbearia_id', barbearia.id)
      .gte('fim', new Date().toISOString())
      .order('inicio')
      .limit(100),
  ]);

  const diasPorProf: Record<string, number[]> = {};
  for (const d of disponibilidade.data ?? []) {
    const lista = (diasPorProf[d.profissional_id] ??= []);
    if (!lista.includes(d.dia_semana)) lista.push(d.dia_semana);
  }

  return (
    <Equipe
      barbeariaId={barbearia.id}
      profissionais={(profissionais.data ?? []) as ProfissionalPainel[]}
      diasPorProf={diasPorProf}
      bloqueios={(bloqueios.data ?? []) as Bloqueio[]}
    />
  );
}
