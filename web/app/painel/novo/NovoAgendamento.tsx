'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { mascaraTelefone, periodo, validarTelefone, type HorarioLivre } from '@/lib/agendamento';
import { duracao, preco } from '@/lib/formatar';
import { diaLongo } from '@/lib/datas';
import type { ProfissionalPainel, ServicoPainel } from '@/lib/painel-tipos';
import { buscarCliente, criarAgendamentoManual, horariosDoDia } from './acoes';
import s from '@/components/interno/ui.module.css';
import n from './novo.module.css';

type Props = {
  servicos: ServicoPainel[];
  profissionais: ProfissionalPainel[];
  diaInicial: string;
  hoje: string;
  profInicial: string;
};

export function NovoAgendamento(p: Props) {
  const router = useRouter();
  const [servicoId, setServicoId] = useState(p.servicos[0]?.id ?? '');
  const [profId, setProfId] = useState(p.profInicial);
  const [dia, setDia] = useState(p.diaInicial);
  const [horarios, setHorarios] = useState<HorarioLivre[] | null>(null);
  const [erroHorarios, setErroHorarios] = useState<string | null>(null);
  const [inicio, setInicio] = useState<string | null>(null);
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [conhecido, setConhecido] = useState<{ nome: string; visitas: number } | null>(null);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [enviando, iniciar] = useTransition();
  const nomeEditado = useRef(false);

  const servico = p.servicos.find((x) => x.id === servicoId);

  useEffect(() => {
    if (!servicoId || !profId || !dia) return;
    let ativo = true;
    setHorarios(null);
    setErroHorarios(null);
    horariosDoDia(servicoId, profId, dia).then((r) => {
      if (!ativo) return;
      if (r.ok) {
        setHorarios(r.horarios);
        setInicio((atual) => (atual && r.horarios.some((h) => h.inicio === atual) ? atual : null));
      } else setErroHorarios(r.erro);
    });
    return () => {
      ativo = false;
    };
  }, [servicoId, profId, dia, versao]);

  // cliente já cadastrado? preenche o nome
  useEffect(() => {
    const d = telefone.replace(/\D/g, '');
    if (d.length < 10) return setConhecido(null);
    let ativo = true;
    buscarCliente(d).then((c) => {
      if (!ativo) return;
      setConhecido(c);
      if (c && !nomeEditado.current) setNome(c.nome);
    });
    return () => {
      ativo = false;
    };
  }, [telefone]);

  if (!p.servicos.length || !p.profissionais.length) {
    return (
      <div className={s.vazio}>
        {!p.servicos.length ? 'Cadastre ao menos um serviço ativo' : 'Cadastre ao menos um profissional ativo'} para marcar horários.
      </div>
    );
  }

  const erroTel = telefone ? validarTelefone(telefone) : null;
  const podeEnviar = !!inicio && nome.trim().length >= 2 && !validarTelefone(telefone);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!inicio) return setErro('Escolha um horário.');
    if (validarTelefone(telefone)) return setErro(validarTelefone(telefone));
    if (nome.trim().length < 2) return setErro('Informe o nome do cliente.');
    setErro(null);
    iniciar(async () => {
      const r = await criarAgendamentoManual({ servicoId, profissionalId: profId, inicio, nome, telefone, observacao });
      if (r.ok) {
        router.push(`/painel${r.dia === p.hoje ? '' : `?data=${r.dia}`}`);
        return;
      }
      setErro(r.erro);
      if (r.horarioOcupado) {
        setInicio(null);
        setVersao((v) => v + 1);
      }
    });
  }

  return (
    <form className={`${s.form} ${n.form}`} onSubmit={enviar}>
      <div className={s.grade}>
        <div className={s.campo}>
          <label htmlFor="servico">Serviço</label>
          <select id="servico" className={s.entrada} value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
            {p.servicos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome} · {duracao(x.duracao_min)} · {preco(x.preco)}
              </option>
            ))}
          </select>
        </div>

        <div className={s.campo}>
          <span className={s.rotulo}>Profissional</span>
          <div className={s.chips} style={{ margin: 0, padding: 0, flexWrap: 'wrap' }} role="group" aria-label="Profissional">
            {p.profissionais.map((x) => (
              <button key={x.id} type="button" className={s.chip} aria-pressed={profId === x.id} onClick={() => setProfId(x.id)}>
                {x.nome.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className={s.campo}>
          <label htmlFor="dia">Data</label>
          <input id="dia" type="date" className={s.entrada} min={p.hoje} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} style={{ colorScheme: 'dark' }} />
          <span className={s.dica} style={{ textTransform: 'capitalize' }}>
            {diaLongo(dia)}
          </span>
        </div>
      </div>

      <div className={s.campo}>
        <span className={s.rotulo}>Horário livre {servico && <span className={s.fraco}>· {duracao(servico.duracao_min)}</span>}</span>
        {erroHorarios && <p className={s.alerta}>{erroHorarios}</p>}
        {!erroHorarios && horarios === null && <p className={s.dica}>Carregando horários…</p>}
        {horarios && horarios.length === 0 && (
          <p className={s.vazio} style={{ padding: 16 }}>
            Sem horários livres nesse dia para esse profissional.
          </p>
        )}
        {horarios && horarios.length > 0 && (
          <div className={n.periodos}>
            {(['Manhã', 'Tarde', 'Noite'] as const).map((per) => {
              const lista = horarios.filter((h) => periodo(h.hora) === per);
              if (!lista.length) return null;
              return (
                <div key={per}>
                  <div className={`${s.pequeno} ${s.fraco}`} style={{ margin: '4px 0 6px' }}>
                    {per}
                  </div>
                  <div className={n.horarios}>
                    {lista.map((h) => (
                      <button key={h.inicio} type="button" className={n.hora} aria-pressed={inicio === h.inicio} onClick={() => setInicio(h.inicio)}>
                        {h.hora}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`${s.grade} ${s.grade2}`}>
        <div className={s.campo}>
          <label htmlFor="telefone">WhatsApp do cliente</label>
          <input
            id="telefone"
            type="tel"
            inputMode="numeric"
            className={s.entrada}
            placeholder="(11) 91234-5678"
            value={telefone}
            onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
            aria-invalid={!!erroTel && telefone.replace(/\D/g, '').length >= 10}
          />
          {conhecido ? (
            <span className={s.dica} style={{ color: 'var(--ok)' }}>
              Cliente cadastrado · {conhecido.visitas} {conhecido.visitas === 1 ? 'visita' : 'visitas'}
            </span>
          ) : (
            <span className={s.dica}>Se já for cliente, o nome é preenchido sozinho.</span>
          )}
        </div>
        <div className={s.campo}>
          <label htmlFor="nome">Nome do cliente</label>
          <input
            id="nome"
            className={s.entrada}
            autoComplete="off"
            autoCapitalize="words"
            value={nome}
            onChange={(e) => {
              nomeEditado.current = true;
              setNome(e.target.value);
            }}
          />
        </div>
      </div>

      <div className={s.campo}>
        <label htmlFor="obs">Observação (opcional)</label>
        <textarea id="obs" className={s.entrada} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: prefere tesoura, alergia a produto…" />
      </div>

      {erro && (
        <p className={s.alerta} role="alert">
          {erro}
        </p>
      )}

      <div className={n.rodape}>
        <button className={`${s.botao} ${s.primario} ${s.largo}`} disabled={!podeEnviar || enviando}>
          {enviando ? 'Salvando…' : inicio ? `Marcar ${horarios?.find((h) => h.inicio === inicio)?.hora ?? ''}` : 'Escolha um horário'}
        </button>
      </div>
    </form>
  );
}
