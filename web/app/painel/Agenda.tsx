'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { diaCurto, diaLongo, diaSP, hora, somarDias } from '@/lib/datas';
import { duracao, linkWhatsapp, preco, whatsappFormatado } from '@/lib/formatar';
import {
  CORES_PROFISSIONAIS,
  ROTULO_STATUS,
  type AgendamentoPainel,
  type ProfissionalPainel,
  type Status,
} from '@/lib/painel-tipos';
import { alterarStatus } from './acoes';
import { Folha, useAviso } from '@/components/interno/Comuns';
import { IDireita, IEsquerda, IMais } from '@/components/interno/Icones';
import { IconeWhatsapp } from '@/components/site/Icones';
import s from '@/components/interno/ui.module.css';
import a from './agenda.module.css';

type Props = {
  agendamentos: AgendamentoPainel[];
  profissionais: ProfissionalPainel[];
  dia: string;
  hoje: string;
  de: string;
  visao: 'dia' | 'semana';
  prof: string | null;
  barbearia: { nome: string };
};

export function Agenda(p: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState<AgendamentoPainel | null>(null);

  const url = (m: Partial<{ data: string; visao: string; prof: string | null }>) => {
    const q = new URLSearchParams();
    const data = m.data ?? p.dia;
    const visao = m.visao ?? p.visao;
    const prof = m.prof === undefined ? p.prof : m.prof;
    if (data !== p.hoje) q.set('data', data);
    if (visao !== 'dia') q.set('visao', visao);
    if (prof) q.set('prof', prof);
    const t = q.toString();
    return `/painel${t ? `?${t}` : ''}`;
  };

  const passo = p.visao === 'semana' ? 7 : 1;
  const ativos = p.profissionais.filter((x) => x.ativo);
  const cor = (id: string) => CORES_PROFISSIONAIS[Math.max(0, p.profissionais.findIndex((x) => x.id === id)) % CORES_PROFISSIONAIS.length];
  const nomeProf = (id: string) => p.profissionais.find((x) => x.id === id)?.nome ?? '';

  const titulo =
    p.visao === 'semana'
      ? `Semana de ${diaCurto(p.de).split(', ')[1]} a ${diaCurto(somarDias(p.de, 6)).split(', ')[1]}`
      : p.dia === p.hoje
        ? 'Hoje'
        : p.dia === somarDias(p.hoje, 1)
          ? 'Amanhã'
          : diaLongo(p.dia).split(',')[0];

  const novoHref = `/painel/novo?data=${p.dia < p.hoje ? p.hoje : p.dia}${p.prof ? `&prof=${p.prof}` : ''}`;

  return (
    <section aria-label="Agenda">
      <div className={s.cabecalho} style={{ alignItems: 'center' }}>
        <div>
          <h1 className={s.titulo} style={{ textTransform: 'capitalize' }}>
            {titulo}
          </h1>
          {p.visao === 'dia' && <p className={s.sub}>{diaLongo(p.dia)}</p>}
        </div>
        <Link href={novoHref} className={`${s.botao} ${s.primario}`}>
          <IMais tamanho={18} /> Novo agendamento
        </Link>
      </div>

      <div className={a.barra}>
        <div className={a.navegacao}>
          <Link href={url({ data: somarDias(p.dia, -passo) })} className={`${s.botao} ${s.icone}`} aria-label="Anterior" scroll={false}>
            <IEsquerda />
          </Link>
          <Link href={url({ data: p.hoje })} className={s.botao} scroll={false}>
            Hoje
          </Link>
          <Link href={url({ data: somarDias(p.dia, passo) })} className={`${s.botao} ${s.icone}`} aria-label="Próximo" scroll={false}>
            <IDireita />
          </Link>
          <input
            type="date"
            className={`${s.entrada} ${a.data}`}
            value={p.dia}
            aria-label="Ir para a data"
            onChange={(e) => e.target.value && router.push(url({ data: e.target.value }), { scroll: false })}
          />
        </div>
        <div className={a.segmentado} role="group" aria-label="Visão">
          <Link href={url({ visao: 'dia' })} aria-current={p.visao === 'dia'} scroll={false}>
            Dia
          </Link>
          <Link href={url({ visao: 'semana' })} aria-current={p.visao === 'semana'} scroll={false}>
            Semana
          </Link>
        </div>
      </div>

      {ativos.length > 1 && (
        <div className={s.chips} style={{ margin: '12px -16px 16px' }} role="group" aria-label="Filtrar por profissional">
          <Link href={url({ prof: null })} className={s.chip} aria-current={!p.prof} scroll={false}>
            Todos
          </Link>
          {ativos.map((x) => (
            <Link key={x.id} href={url({ prof: x.id })} className={s.chip} aria-current={p.prof === x.id} scroll={false}>
              <span className={a.ponto} style={{ background: cor(x.id) }} />
              {x.nome.split(' ')[0]}
            </Link>
          ))}
        </div>
      )}

      {p.visao === 'dia' ? (
        <ListaDoDia
          itens={p.agendamentos}
          cor={cor}
          nomeProf={nomeProf}
          onAbrir={setAberto}
          vazio={
            <div className={s.vazio}>
              Nenhum agendamento {p.dia === p.hoje ? 'hoje' : 'neste dia'}.
              <div style={{ marginTop: 12 }}>
                <Link href={novoHref} className={s.botao}>
                  <IMais tamanho={18} /> Marcar horário
                </Link>
              </div>
            </div>
          }
        />
      ) : (
        <div className={a.semana}>
          {Array.from({ length: 7 }, (_, i) => somarDias(p.de, i)).map((d) => {
            const doDia = p.agendamentos.filter((x) => diaSP(x.inicio) === d);
            const validos = doDia.filter((x) => x.status !== 'cancelado').length;
            return (
              <div key={d} className={`${a.diaColuna} ${d === p.hoje ? a.diaHoje : ''}`}>
                <Link href={url({ data: d, visao: 'dia' })} className={a.diaTitulo}>
                  <span style={{ textTransform: 'capitalize' }}>{diaCurto(d)}</span>
                  <span className={s.fraco}>{validos || ''}</span>
                </Link>
                {doDia.length === 0 ? (
                  <p className={`${s.pequeno} ${s.fraco} ${a.diaVazio}`}>—</p>
                ) : (
                  <ListaDoDia itens={doDia} cor={cor} nomeProf={nomeProf} onAbrir={setAberto} compacta vazio={null} />
                )}
              </div>
            );
          })}
        </div>
      )}

      <Folha aberta={!!aberto} titulo="Agendamento" onFechar={() => setAberto(null)}>
        {aberto && (
          <Detalhes
            ag={aberto}
            nomeProf={nomeProf(aberto.profissional_id)}
            barbearia={p.barbearia.nome}
            onFeito={() => setAberto(null)}
          />
        )}
      </Folha>
    </section>
  );
}

function ListaDoDia({
  itens,
  cor,
  nomeProf,
  onAbrir,
  compacta,
  vazio,
}: {
  itens: AgendamentoPainel[];
  cor: (id: string) => string;
  nomeProf: (id: string) => string;
  onAbrir: (a: AgendamentoPainel) => void;
  compacta?: boolean;
  vazio: React.ReactNode;
}) {
  if (!itens.length) return <>{vazio}</>;
  return (
    <ul className={`${a.lista} ${compacta ? a.compacta : ''}`}>
      {itens.map((x) => (
        <li key={x.id}>
          <button
            type="button"
            className={`${a.cartao} ${x.status === 'cancelado' ? a.cancelado : ''}`}
            style={{ '--cor': cor(x.profissional_id) } as React.CSSProperties}
            onClick={() => onAbrir(x)}
          >
            <span className={a.horas}>
              <strong>{hora(x.inicio)}</strong>
              {!compacta && <span>{hora(x.fim)}</span>}
            </span>
            <span className={a.corpo}>
              <span className={a.cliente}>{x.cliente?.nome ?? 'Cliente'}</span>
              <span className={a.detalhe}>
                {x.servico?.nome}
                {!compacta && ` · ${nomeProf(x.profissional_id)}`}
              </span>
            </span>
            {(!compacta || x.status !== 'confirmado') && (
              <span className={`${s.badge} ${s[`st-${x.status}`]} ${compacta ? a.badgeCompacto : ''}`}>{ROTULO_STATUS[x.status]}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Detalhes({
  ag,
  nomeProf,
  barbearia,
  onFeito,
}: {
  ag: AgendamentoPainel;
  nomeProf: string;
  barbearia: string;
  onFeito: () => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, mostrar] = useAviso();

  const dia = diaSP(ag.inicio);
  const primeiroNome = ag.cliente?.nome.split(' ')[0] ?? '';
  const wa = linkWhatsapp(
    ag.cliente?.telefone ?? null,
    `Olá, ${primeiroNome}! Aqui é da ${barbearia}. Sobre o seu horário: ${ag.servico?.nome} em ${diaCurto(dia)} às ${hora(ag.inicio)}.`,
  );

  function mudar(status: Status, texto: string) {
    setErro(null);
    iniciar(async () => {
      const r = await alterarStatus(ag.id, status);
      if (!r.ok) return setErro(r.erro);
      mostrar(texto);
      setTimeout(onFeito, 500);
    });
  }

  return (
    <div className={s.form}>
      <div>
        <div className={s.linha} style={{ justifyContent: 'space-between' }}>
          <strong style={{ fontSize: '1.15rem' }}>{ag.cliente?.nome}</strong>
          <span className={`${s.badge} ${s[`st-${ag.status}`]}`}>{ROTULO_STATUS[ag.status]}</span>
        </div>
        <div className={s.suave}>{whatsappFormatado(ag.cliente?.telefone ?? null)}</div>
      </div>

      <dl className={a.dados}>
        <div>
          <dt>Quando</dt>
          <dd style={{ textTransform: 'capitalize' }}>
            {diaLongo(dia)} · {hora(ag.inicio)}–{hora(ag.fim)}
          </dd>
        </div>
        <div>
          <dt>Serviço</dt>
          <dd>
            {ag.servico?.nome} · {duracao(ag.servico?.duracao_min ?? 0)}
          </dd>
        </div>
        <div>
          <dt>Profissional</dt>
          <dd>{nomeProf}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{preco(Number(ag.preco_cobrado ?? 0))}</dd>
        </div>
        <div>
          <dt>Origem</dt>
          <dd>{ag.origem === 'online' ? 'Agendado pelo site' : 'Marcado no painel'}</dd>
        </div>
        {ag.observacao && (
          <div>
            <dt>Observação</dt>
            <dd>{ag.observacao}</dd>
          </div>
        )}
      </dl>

      {erro && <p className={s.alerta}>{erro}</p>}

      {ag.status === 'confirmado' ? (
        <div className={a.acoes}>
          <button className={`${s.botao} ${s.primario}`} disabled={pendente} onClick={() => mudar('concluido', 'Marcado como concluído')}>
            Concluído
          </button>
          <button className={s.botao} disabled={pendente} onClick={() => mudar('faltou', 'Marcado como falta')}>
            Faltou
          </button>
          {confirmarCancelar ? (
            <button className={`${s.botao} ${s.perigo}`} disabled={pendente} onClick={() => mudar('cancelado', 'Agendamento cancelado')}>
              Confirmar cancelamento
            </button>
          ) : (
            <button className={`${s.botao} ${s.perigo}`} disabled={pendente} onClick={() => setConfirmarCancelar(true)}>
              Cancelar
            </button>
          )}
        </div>
      ) : (
        <button className={s.botao} disabled={pendente} onClick={() => mudar('confirmado', 'Reaberto como confirmado')}>
          Voltar para confirmado
        </button>
      )}

      {wa && (
        <a className={`${s.botao} ${s.largo}`} href={wa} target="_blank" rel="noopener noreferrer">
          <IconeWhatsapp tamanho={18} /> Chamar no WhatsApp
        </a>
      )}
      {aviso}
    </div>
  );
}
