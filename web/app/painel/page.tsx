import type { Metadata } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import { diaSP, hora, inicioDaSemana, inicioDoDia, somarDias, validarDia } from '@/lib/datas';
import { preco, precoCurto } from '@/lib/formatar';
import type { AgendamentoPainel, ProfissionalPainel } from '@/lib/painel-tipos';
import { Agenda } from './Agenda';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Agenda' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS =
  'id, inicio, fim, status, origem, preco_cobrado, observacao, profissional_id, cliente:clientes(id, nome, telefone), servico:servicos(id, nome, duracao_min)';

type Busca = { data?: string; visao?: string; prof?: string };

export default async function PaginaAgenda({ searchParams }: { searchParams: Promise<Busca> }) {
  const { barbearia } = await exigirPainel();
  const sp = await searchParams;
  const hoje = diaSP();
  const dia = validarDia(sp.data) ?? hoje;
  const visao = sp.visao === 'semana' ? 'semana' : 'dia';
  const prof = sp.prof && UUID.test(sp.prof) ? sp.prof : null;
  const de = visao === 'semana' ? inicioDaSemana(dia) : dia;
  const ate = somarDias(de, visao === 'semana' ? 7 : 1);

  const sb = await supabaseServidor();
  let consulta = sb
    .from('agendamentos')
    .select(CAMPOS)
    .eq('barbearia_id', barbearia.id)
    .gte('inicio', inicioDoDia(de))
    .lt('inicio', inicioDoDia(ate))
    .order('inicio');
  if (prof) consulta = consulta.eq('profissional_id', prof);

  const [periodo, profissionais, doDia] = await Promise.all([
    consulta,
    sb.from('profissionais').select('id, nome, foto_url, ativo, ordem').eq('barbearia_id', barbearia.id).order('ordem').order('nome'),
    sb
      .from('agendamentos')
      .select(CAMPOS)
      .eq('barbearia_id', barbearia.id)
      .gte('inicio', inicioDoDia(hoje))
      .lt('inicio', inicioDoDia(somarDias(hoje, 1)))
      .neq('status', 'cancelado')
      .order('inicio'),
  ]);

  const deHoje = (doDia.data ?? []) as unknown as AgendamentoPainel[];

  return (
    <>
      <Resumo agendamentos={deHoje} profissionais={(profissionais.data ?? []) as ProfissionalPainel[]} />
      <Agenda
        agendamentos={(periodo.data ?? []) as unknown as AgendamentoPainel[]}
        profissionais={(profissionais.data ?? []) as ProfissionalPainel[]}
        dia={dia}
        hoje={hoje}
        de={de}
        visao={visao}
        prof={prof}
        barbearia={{ nome: barbearia.nome }}
      />
    </>
  );
}

function Resumo({ agendamentos, profissionais }: { agendamentos: AgendamentoPainel[]; profissionais: ProfissionalPainel[] }) {
  const agora = Date.now();
  const validos = agendamentos.filter((a) => a.status === 'confirmado' || a.status === 'concluido');
  const previsto = validos.reduce((t, a) => t + Number(a.preco_cobrado ?? 0), 0);
  const realizado = agendamentos.filter((a) => a.status === 'concluido').reduce((t, a) => t + Number(a.preco_cobrado ?? 0), 0);
  const proximos = agendamentos.filter((a) => a.status === 'confirmado' && Date.parse(a.fim) > agora).slice(0, 3);
  const nomeProf = (id: string) => profissionais.find((p) => p.id === id)?.nome.split(' ')[0] ?? '';

  return (
    <section aria-label="Resumo de hoje" style={{ marginBottom: 22 }}>
      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statRotulo}>Hoje</div>
          <div className={s.statValor}>{validos.length}</div>
          <div className={`${s.pequeno} ${s.fraco}`}>{validos.length === 1 ? 'agendamento' : 'agendamentos'}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statRotulo}>Previsto</div>
          <div className={s.statValor}>{precoCurto(previsto)}</div>
          <div className={`${s.pequeno} ${s.fraco}`}>{preco(realizado)} concluído</div>
        </div>
        <div className={s.stat}>
          <div className={s.statRotulo}>Próximo</div>
          <div className={s.statValor}>{proximos[0] ? hora(proximos[0].inicio) : '—'}</div>
          <div className={`${s.pequeno} ${s.fraco}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {proximos[0]?.cliente?.nome.split(' ')[0] ?? 'livre'}
          </div>
        </div>
      </div>
      {proximos.length > 0 && (
        <div className={s.card} style={{ marginTop: 10, padding: '10px 14px' }}>
          <div className={`${s.pequeno} ${s.fraco}`} style={{ marginBottom: 4 }}>
            Próximos horários
          </div>
          {proximos.map((a) => (
            <div key={a.id} className={`${s.linha} ${s.pequeno}`} style={{ flexWrap: 'nowrap', padding: '3px 0' }}>
              <strong className={s.num}>{hora(a.inicio)}</strong>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.cliente?.nome} · <span className={s.suave}>{a.servico?.nome}</span>
              </span>
              <span className={s.fraco} style={{ marginLeft: 'auto', flex: 'none' }}>
                {nomeProf(a.profissional_id)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
