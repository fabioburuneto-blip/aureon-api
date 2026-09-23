import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import { diaSP, validarDia } from '@/lib/datas';
import type { ProfissionalPainel, ServicoPainel } from '@/lib/painel-tipos';
import { IEsquerda } from '@/components/interno/Icones';
import { NovoAgendamento } from './NovoAgendamento';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Novo agendamento' };

export default async function PaginaNovo({ searchParams }: { searchParams: Promise<{ data?: string; prof?: string }> }) {
  const { barbearia } = await exigirPainel();
  const sp = await searchParams;
  const hoje = diaSP();
  const dia = validarDia(sp.data);
  const sb = await supabaseServidor();
  const [servicos, profissionais] = await Promise.all([
    sb.from('servicos').select('id, nome, descricao, preco, duracao_min, ativo, ordem').eq('barbearia_id', barbearia.id).eq('ativo', true).order('ordem').order('nome'),
    sb.from('profissionais').select('id, nome, foto_url, ativo, ordem').eq('barbearia_id', barbearia.id).eq('ativo', true).order('ordem').order('nome'),
  ]);
  const profs = (profissionais.data ?? []) as ProfissionalPainel[];

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <Link href="/painel" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`} style={{ marginLeft: -12 }}>
            <IEsquerda tamanho={18} /> Agenda
          </Link>
          <h1 className={s.titulo}>Novo agendamento</h1>
          <p className={s.sub}>Marque um horário para um cliente que ligou ou chegou na barbearia.</p>
        </div>
      </div>
      <NovoAgendamento
        servicos={(servicos.data ?? []) as ServicoPainel[]}
        profissionais={profs}
        diaInicial={dia && dia >= hoje ? dia : hoje}
        hoje={hoje}
        profInicial={profs.find((p) => p.id === sp.prof)?.id ?? profs[0]?.id ?? ''}
      />
    </>
  );
}
