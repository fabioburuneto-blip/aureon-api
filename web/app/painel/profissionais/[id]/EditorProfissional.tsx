'use client';

import { useState, useTransition } from 'react';
import type { ProfissionalPainel } from '@/lib/painel-tipos';
import { atualizarProfissional, salvarHorarios, type Intervalo } from '../acoes';
import { Chave, useAviso } from '@/components/interno/Comuns';
import { FotoUpload } from '@/components/interno/FotoUpload';
import { ICopiar, IFechar, IMais } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';
import e from './editor.module.css';

const DIAS = [
  { n: 1, nome: 'Segunda' },
  { n: 2, nome: 'Terça' },
  { n: 3, nome: 'Quarta' },
  { n: 4, nome: 'Quinta' },
  { n: 5, nome: 'Sexta' },
  { n: 6, nome: 'Sábado' },
  { n: 0, nome: 'Domingo' },
];

type Faixa = { de: string; ate: string };

export function EditorProfissional({
  barbeariaId,
  profissional,
  horarios,
  novo,
}: {
  barbeariaId: string;
  profissional: ProfissionalPainel;
  horarios: Intervalo[];
  novo: boolean;
}) {
  const [aviso, mostrar] = useAviso();

  // ---- dados ----
  const [nome, setNome] = useState(profissional.nome);
  const [foto, setFoto] = useState<string | null>(profissional.foto_url);
  const [ativo, setAtivo] = useState(profissional.ativo);
  const [erroDados, setErroDados] = useState<string | null>(null);
  const [salvandoDados, iniciarDados] = useTransition();

  function salvarDados(dados: { nome: string; foto_url: string | null; ativo: boolean }, texto = 'Dados salvos') {
    setErroDados(null);
    iniciarDados(async () => {
      const r = await atualizarProfissional(profissional.id, dados);
      if (r.ok) mostrar(texto);
      else setErroDados(r.erro);
    });
  }

  // ---- horários ----
  const inicial: Record<number, Faixa[]> = {};
  for (const d of DIAS) inicial[d.n] = horarios.filter((h) => h.dia_semana === d.n).map((h) => ({ de: h.hora_inicio, ate: h.hora_fim }));
  const [grade, setGrade] = useState(inicial);
  const [alterado, setAlterado] = useState(novo);
  const [erroHorarios, setErroHorarios] = useState<string | null>(null);
  const [salvandoHorarios, iniciarHorarios] = useTransition();

  const mudarGrade = (fn: (g: Record<number, Faixa[]>) => Record<number, Faixa[]>) => {
    setGrade((g) => fn(structuredClone(g)));
    setAlterado(true);
  };

  function alternarDia(n: number, trabalha: boolean) {
    mudarGrade((g) => {
      g[n] = trabalha ? [{ de: '09:00', ate: '12:00' }, { de: '13:00', ate: '19:00' }] : [];
      return g;
    });
  }

  function copiarParaUteis(origem: number) {
    mudarGrade((g) => {
      for (const d of [1, 2, 3, 4, 5, 6]) if (d !== origem) g[d] = structuredClone(g[origem]);
      return g;
    });
  }

  function salvarGrade() {
    const itens: Intervalo[] = [];
    for (const d of DIAS)
      for (const f of grade[d.n]) {
        if (!f.de || !f.ate || f.ate <= f.de) return setErroHorarios(`${d.nome}: o fim precisa ser depois do início.`);
        itens.push({ dia_semana: d.n, hora_inicio: f.de, hora_fim: f.ate });
      }
    setErroHorarios(null);
    iniciarHorarios(async () => {
      const r = await salvarHorarios(profissional.id, itens);
      if (r.ok) {
        setAlterado(false);
        mostrar('Horários salvos');
      } else setErroHorarios(r.erro);
    });
  }

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>{profissional.nome}</h1>
          {novo && <p className={s.sub}>Cadastrado! Agora defina os dias e horários de trabalho.</p>}
        </div>
      </div>

      <section className={`${s.card} ${s.form}`}>
        <FotoUpload
          barbeariaId={barbeariaId}
          pasta="profissionais"
          url={foto}
          max={800}
          onMudar={(u) => {
            setFoto(u);
            salvarDados({ nome, foto_url: u, ativo }, u ? 'Foto atualizada' : 'Foto removida');
          }}
        />
        <div className={s.campo}>
          <label htmlFor="nome">Nome</label>
          <div className={s.linha} style={{ flexWrap: 'nowrap' }}>
            <input id="nome" className={s.entrada} value={nome} onChange={(ev) => setNome(ev.target.value)} maxLength={80} />
            {nome.trim() !== profissional.nome && (
              <button className={`${s.botao} ${s.primario}`} disabled={salvandoDados} onClick={() => salvarDados({ nome, foto_url: foto, ativo })}>
                Salvar
              </button>
            )}
          </div>
        </div>
        <div className={`${s.linha} ${s.entre}`}>
          <div>
            <div style={{ fontWeight: 600 }}>Ativo</div>
            <div className={`${s.pequeno} ${s.suave}`}>Inativos somem do site e do agendamento.</div>
          </div>
          <Chave
            ligada={ativo}
            rotulo="Ativo"
            desabilitada={salvandoDados}
            onMudar={(v) => {
              setAtivo(v);
              salvarDados({ nome, foto_url: foto, ativo: v }, v ? 'Profissional ativado' : 'Profissional desativado');
            }}
          />
        </div>
        {erroDados && <p className={s.alerta}>{erroDados}</p>}
      </section>

      <h2 className={s.secaoTitulo}>Horários de trabalho</h2>
      <section className={s.lista}>
        {DIAS.map((d) => {
          const faixas = grade[d.n];
          const trabalha = faixas.length > 0;
          return (
            <div key={d.n} className={`${e.dia} ${trabalha ? '' : e.folga}`}>
              <div className={e.diaTopo}>
                <Chave ligada={trabalha} onMudar={(v) => alternarDia(d.n, v)} rotulo={`Trabalha na ${d.nome.toLowerCase()}`} />
                <strong className={e.diaNome}>{d.nome}</strong>
                {!trabalha && <span className={`${s.pequeno} ${s.fraco}`}>Folga</span>}
                {trabalha && d.n !== 0 && (
                  <button type="button" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao} ${e.copiar}`} onClick={() => copiarParaUteis(d.n)} title="Copiar para seg–sáb" aria-label={`Copiar horários de ${d.nome.toLowerCase()} para seg–sáb`}>
                    <ICopiar tamanho={16} /> <span>Copiar p/ seg–sáb</span>
                  </button>
                )}
              </div>
              {trabalha && (
                <div className={e.faixas}>
                  {faixas.map((f, i) => (
                    <div key={i} className={e.faixa}>
                      <input
                        type="time"
                        step={900}
                        className={s.entrada}
                        value={f.de}
                        aria-label={`${d.nome}, início ${i + 1}`}
                        onChange={(ev) => mudarGrade((g) => ((g[d.n][i].de = ev.target.value), g))}
                      />
                      <span className={s.fraco}>até</span>
                      <input
                        type="time"
                        step={900}
                        className={s.entrada}
                        value={f.ate}
                        aria-label={`${d.nome}, fim ${i + 1}`}
                        onChange={(ev) => mudarGrade((g) => ((g[d.n][i].ate = ev.target.value), g))}
                      />
                      <button
                        type="button"
                        className={`${s.botao} ${s.fantasma} ${s.icone}`}
                        aria-label="Remover intervalo"
                        onClick={() => mudarGrade((g) => (g[d.n].splice(i, 1), g))}
                      >
                        <IFechar tamanho={18} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`}
                    style={{ justifySelf: 'start' }}
                    onClick={() =>
                      mudarGrade((g) => {
                        const ult = g[d.n][g[d.n].length - 1];
                        g[d.n].push({ de: ult?.ate ?? '09:00', ate: ult ? minMax(ult.ate, 60) : '18:00' });
                        return g;
                      })
                    }
                  >
                    <IMais tamanho={16} /> Intervalo
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>
      <p className={s.dica} style={{ marginTop: 8 }}>
        Use dois intervalos para a pausa do almoço (ex.: 09:00–12:00 e 13:00–19:00).
      </p>
      {erroHorarios && (
        <p className={s.alerta} style={{ marginTop: 12 }}>
          {erroHorarios}
        </p>
      )}
      <div className={e.salvar}>
        <button className={`${s.botao} ${s.primario} ${s.largo}`} disabled={!alterado || salvandoHorarios} onClick={salvarGrade}>
          {salvandoHorarios ? 'Salvando…' : alterado ? 'Salvar horários' : 'Horários salvos'}
        </button>
      </div>
      {aviso}
    </>
  );
}

function minMax(h: string, somar: number) {
  const [a, b] = h.split(':').map(Number);
  const t = Math.min(23 * 60 + 45, a * 60 + b + somar);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
