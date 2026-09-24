'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Servico } from '@/lib/barbearia';
import { duracao } from '@/lib/formatar';
import { dataLonga, partesDia, periodo, type DiaDisponivel, type HorarioLivre } from '@/lib/agendamento';
import { listarDias, listarHorarios } from '@/app/[slug]/agendar/acoes';
import { IconeAlerta } from '@/components/site/Icones';
import s from './agendamento.module.css';

type Props = {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  slug: string;
  servico: Servico;
  profissionalId: string | null;
  nomeProfissional: string;
  dia: string | null;
  onDia: (d: string | null) => void;
  horarioSelecionado: string | null;
  onEscolher: (h: HorarioLivre) => void;
  aviso: string | null;
  versao: number;
};

type Estado<T> = { status: 'carregando' } | { status: 'erro'; mensagem: string } | { status: 'ok'; dados: T };

export function PassoHorario(p: Props) {
  const { slug, servico, profissionalId, dia, onDia, versao } = p;
  const [dias, setDias] = useState<Estado<DiaDisponivel[]>>({ status: 'carregando' });
  const [horarios, setHorarios] = useState<Estado<HorarioLivre[]>>({ status: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  const faixaRef = useRef<HTMLDivElement>(null);
  const diaRef = useRef(dia);
  diaRef.current = dia;

  // Dias com vaga nos próximos 30 dias
  useEffect(() => {
    let ativo = true;
    setDias({ status: 'carregando' });
    listarDias(slug, servico.id, profissionalId)
      .then((r) => {
        if (!ativo) return;
        if (!r.ok) return setDias({ status: 'erro', mensagem: r.mensagem });
        setDias({ status: 'ok', dados: r.dados });
        const atual = r.dados.find((d) => d.data === diaRef.current && d.horarios > 0);
        onDia(atual ? atual.data : (r.dados.find((d) => d.horarios > 0)?.data ?? null));
      })
      .catch(() => ativo && setDias({ status: 'erro', mensagem: 'Sem conexão. Verifique sua internet.' }));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, servico.id, profissionalId, versao, tentativa]);

  // Horários do dia escolhido
  useEffect(() => {
    if (!dia || dias.status !== 'ok') return;
    let ativo = true;
    setHorarios({ status: 'carregando' });
    listarHorarios(slug, servico.id, profissionalId, dia)
      .then((r) => {
        if (!ativo) return;
        setHorarios(r.ok ? { status: 'ok', dados: r.dados } : { status: 'erro', mensagem: r.mensagem });
      })
      .catch(() => ativo && setHorarios({ status: 'erro', mensagem: 'Sem conexão. Verifique sua internet.' }));
    return () => {
      ativo = false;
    };
  }, [slug, servico.id, profissionalId, dia, dias.status, versao, tentativa]);

  // Mantém o dia escolhido visível na faixa
  useEffect(() => {
    faixaRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [dia, dias.status]);

  const semNenhumDia = dias.status === 'ok' && !dias.dados.some((d) => d.horarios > 0);

  return (
    <>
      <div className={s.cabecalho}>
        <h1 ref={p.tituloRef} tabIndex={-1} className={s.titulo}>
          Quando?
        </h1>
        <p className={s.sub}>
          {servico.nome} · {duracao(servico.duracao_min)}
          {p.nomeProfissional && ` · ${p.nomeProfissional}`}
        </p>
      </div>

      {p.aviso && (
        <div className={s.alerta} role="alert">
          <IconeAlerta />
          <p>{p.aviso}</p>
        </div>
      )}

      {/* Faixa de dias */}
      <h2 className={s.subtitulo}>Data</h2>
      {dias.status === 'erro' ? (
        <Falha mensagem={dias.mensagem} onTentar={() => setTentativa((t) => t + 1)} />
      ) : (
        <div className={s.faixa} ref={faixaRef} role="group" aria-label="Escolha a data">
          {dias.status === 'carregando'
            ? Array.from({ length: 7 }, (_, i) => <span key={i} className={`${s.dia} ${s.esqueleto}`} />)
            : dias.dados.map((d) => {
                const { semana, dia: numero, mes } = partesDia(d.data);
                const livre = d.horarios > 0;
                return (
                  <button
                    key={d.data}
                    type="button"
                    data-dia={d.data}
                    className={s.dia}
                    disabled={!livre}
                    aria-pressed={d.data === dia}
                    aria-label={`${dataLonga(d.data)}${livre ? '' : ', sem horários'}`}
                    onClick={() => onDia(d.data)}
                  >
                    <span className={s.diaSemana}>{semana}</span>
                    <span className={s.diaNumero}>{numero}</span>
                    <span className={s.diaMes}>{mes}</span>
                  </button>
                );
              })}
        </div>
      )}

      {semNenhumDia && (
        <p className={s.vazio}>
          Não há horários livres nos próximos 30 dias
          {profissionalId ? ' com este profissional. Volte e escolha "Qualquer profissional".' : '.'}
        </p>
      )}

      {/* Horários */}
      {dia && dias.status === 'ok' && (
        <section aria-live="polite">
          <h2 className={s.subtitulo}>
            Horário <span className={s.subtituloDetalhe}>{dataLonga(dia)}</span>
          </h2>
          {horarios.status === 'carregando' && (
            <div className={s.grade}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className={`${s.hora} ${s.esqueleto}`} />
              ))}
            </div>
          )}
          {horarios.status === 'erro' && <Falha mensagem={horarios.mensagem} onTentar={() => setTentativa((t) => t + 1)} />}
          {horarios.status === 'ok' && horarios.dados.length === 0 && (
            <p className={s.vazio}>Os horários deste dia acabaram de ser preenchidos. Escolha outra data.</p>
          )}
          {horarios.status === 'ok' &&
            (['Manhã', 'Tarde', 'Noite'] as const).map((per) => {
              const lista = horarios.dados.filter((h) => periodo(h.hora) === per);
              if (!lista.length) return null;
              return (
                <div key={per} className={s.periodo}>
                  <h3 className={s.periodoTitulo}>{per}</h3>
                  <div className={s.grade}>
                    {lista.map((h) => (
                      <button
                        key={h.inicio}
                        type="button"
                        data-inicio={h.inicio}
                        className={s.hora}
                        aria-pressed={p.horarioSelecionado !== null && Date.parse(p.horarioSelecionado) === Date.parse(h.inicio)}
                        onClick={() => p.onEscolher(h)}
                      >
                        {h.hora}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
        </section>
      )}
    </>
  );
}

function Falha({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div className={s.alerta} role="alert">
      <IconeAlerta />
      <div>
        <p>{mensagem}</p>
        <button type="button" className={s.linkSimples} onClick={onTentar}>
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
