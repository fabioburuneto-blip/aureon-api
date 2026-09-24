'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { dataCurta, diaCurto, diaSP, hora, instanteSP, somarDias } from '@/lib/datas';
import { iniciais } from '@/lib/formatar';
import type { ProfissionalPainel } from '@/lib/painel-tipos';
import { criarBloqueio, criarProfissional, removerBloqueio } from './acoes';
import { Folha, useAviso } from '@/components/interno/Comuns';
import { FotoUpload } from '@/components/interno/FotoUpload';
import { IDireita, ILixo, IMais } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';

export type Bloqueio = { id: string; profissional_id: string | null; inicio: string; fim: string; motivo: string | null };

const SIGLAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ORDEM = [1, 2, 3, 4, 5, 6, 0];

export function Equipe({
  barbeariaId,
  profissionais,
  diasPorProf,
  bloqueios,
}: {
  barbeariaId: string;
  profissionais: ProfissionalPainel[];
  diasPorProf: Record<string, number[]>;
  bloqueios: Bloqueio[];
}) {
  const [novoProf, setNovoProf] = useState(false);
  const [novoBloqueio, setNovoBloqueio] = useState(false);
  const [aviso, mostrar] = useAviso();
  const [pendente, iniciar] = useTransition();
  const [apagando, setApagando] = useState<string | null>(null);
  const nome = (id: string | null) => (id ? (profissionais.find((p) => p.id === id)?.nome ?? '—') : 'Toda a barbearia');

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Equipe</h1>
          <p className={s.sub}>Profissionais, horários de trabalho e bloqueios da agenda.</p>
        </div>
        <button className={`${s.botao} ${s.primario}`} onClick={() => setNovoProf(true)}>
          <IMais tamanho={18} /> Novo profissional
        </button>
      </div>

      {profissionais.length === 0 ? (
        <div className={s.vazio}>Cadastre o primeiro profissional para começar a receber agendamentos.</div>
      ) : (
        <ul className={s.lista}>
          {profissionais.map((p) => {
            const dias = ORDEM.filter((d) => diasPorProf[p.id]?.includes(d));
            return (
              <li key={p.id}>
                <Link href={`/painel/profissionais/${p.id}`} className={`${s.item} ${p.ativo ? '' : s.itemInativo}`} style={{ textDecoration: 'none' }}>
                  <span className={s.avatar}>{p.foto_url ? <img src={p.foto_url} alt="" /> : iniciais(p.nome)}</span>
                  <span className={s.itemCorpo}>
                    <span className={s.itemTitulo} style={{ display: 'block' }}>
                      {p.nome}
                    </span>
                    <span className={s.itemSub} style={dias.length ? undefined : { color: 'var(--aviso)' }}>
                      {!p.ativo ? 'Inativo · ' : ''}
                      {dias.length ? dias.map((d) => SIGLAS[d]).join(', ') : 'Sem horários de trabalho definidos'}
                    </span>
                  </span>
                  <IDireita className={s.fraco} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className={`${s.cabecalho}`} style={{ marginTop: 32, alignItems: 'center' }}>
        <div>
          <h2 className={s.titulo} style={{ fontSize: '1.15rem' }}>
            Bloqueios
          </h2>
          <p className={s.sub}>Folgas, almoço e férias: esses horários não aparecem no agendamento.</p>
        </div>
        <button className={s.botao} onClick={() => setNovoBloqueio(true)}>
          <IMais tamanho={18} /> Novo bloqueio
        </button>
      </div>

      {bloqueios.length === 0 ? (
        <div className={s.vazio}>Nenhum bloqueio futuro.</div>
      ) : (
        <ul className={s.lista}>
          {bloqueios.map((b) => (
            <li key={b.id} className={s.item}>
              <div className={s.itemCorpo}>
                <div className={s.itemTitulo}>
                  {b.motivo || 'Bloqueio'} · <span className={s.suave}>{nome(b.profissional_id)}</span>
                </div>
                <div className={s.itemSub}>
                  {periodo(b).replace(/^./, (c) => c.toUpperCase())}
                </div>
              </div>
              {apagando === b.id ? (
                <button
                  className={`${s.botao} ${s.perigo} ${s.pequenoBotao}`}
                  disabled={pendente}
                  onClick={() =>
                    iniciar(async () => {
                      const r = await removerBloqueio(b.id);
                      mostrar(r.ok ? 'Bloqueio removido' : r.erro);
                      setApagando(null);
                    })
                  }
                >
                  Remover?
                </button>
              ) : (
                <button className={`${s.botao} ${s.fantasma} ${s.icone}`} onClick={() => setApagando(b.id)} aria-label="Remover bloqueio">
                  <ILixo tamanho={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Folha aberta={novoProf} titulo="Novo profissional" onFechar={() => setNovoProf(false)}>
        {novoProf && <FormNovoProfissional barbeariaId={barbeariaId} />}
      </Folha>
      <Folha aberta={novoBloqueio} titulo="Novo bloqueio" onFechar={() => setNovoBloqueio(false)}>
        {novoBloqueio && (
          <FormBloqueio
            profissionais={profissionais.filter((p) => p.ativo)}
            onSalvo={(t) => {
              setNovoBloqueio(false);
              mostrar(t);
            }}
          />
        )}
      </Folha>
      {aviso}
    </>
  );
}

/** Texto do período: "qui, 24/09 · 12:00–13:00" ou "24/09 a 30/09 · dia inteiro" */
function periodo(b: Bloqueio) {
  const di = diaSP(b.inicio);
  const fimMenos = new Date(Date.parse(b.fim) - 1).toISOString();
  const df = diaSP(fimMenos);
  const inteiro = hora(b.inicio) === '00:00' && hora(b.fim) === '00:00';
  if (inteiro) return di === df ? `${diaCurto(di)} · dia inteiro` : `${dataCurta(b.inicio).slice(0, 5)} a ${dataCurta(fimMenos).slice(0, 5)} · dias inteiros`;
  if (di === diaSP(b.fim)) return `${diaCurto(di)} · ${hora(b.inicio)}–${hora(b.fim)}`;
  return `${diaCurto(di)} ${hora(b.inicio)} até ${diaCurto(diaSP(b.fim))} ${hora(b.fim)}`;
}

function FormNovoProfissional({ barbeariaId }: { barbeariaId: string }) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await criarProfissional(nome, foto);
          if (r.ok && r.id) router.push(`/painel/profissionais/${r.id}?novo=1`);
          else if (!r.ok) setErro(r.erro);
        });
      }}
    >
      <FotoUpload barbeariaId={barbeariaId} pasta="profissionais" url={foto} onMudar={setFoto} max={800} />
      <div className={s.campo}>
        <label htmlFor="prof-nome">Nome</label>
        <input id="prof-nome" className={s.entrada} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoCapitalize="words" required />
      </div>
      <p className={s.dica}>Depois de cadastrar, defina os dias e horários de trabalho.</p>
      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente}>
        {pendente ? 'Salvando…' : 'Cadastrar e definir horários'}
      </button>
    </form>
  );
}

const MOTIVOS = [
  { rotulo: 'Folga', inteiro: true },
  { rotulo: 'Almoço', inteiro: false, de: '12:00', ate: '13:00' },
  { rotulo: 'Férias', inteiro: true },
  { rotulo: 'Outro', inteiro: false, de: '09:00', ate: '10:00' },
];

function FormBloqueio({ profissionais, onSalvo }: { profissionais: ProfissionalPainel[]; onSalvo: (t: string) => void }) {
  const hoje = diaSP();
  const [motivo, setMotivo] = useState('Folga');
  const [outro, setOutro] = useState('');
  const [prof, setProf] = useState<string>(profissionais[0]?.id ?? '');
  const [inteiro, setInteiro] = useState(true);
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);
  const [hIni, setHIni] = useState('12:00');
  const [hFim, setHFim] = useState('13:00');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function escolherMotivo(m: (typeof MOTIVOS)[number]) {
    setMotivo(m.rotulo);
    setInteiro(m.inteiro);
    if (m.de) setHIni(m.de);
    if (m.ate) setHFim(m.ate);
    if (m.rotulo === 'Férias' && ate === de) setAte(somarDias(de, 6));
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const inicio = inteiro ? instanteSP(de, '00:00') : instanteSP(de, hIni);
    const fim = inteiro ? instanteSP(somarDias(ate < de ? de : ate, 1), '00:00') : instanteSP(de, hFim);
    iniciar(async () => {
      const r = await criarBloqueio({
        profissional_id: prof || null,
        inicio,
        fim,
        motivo: motivo === 'Outro' ? outro || 'Bloqueio' : motivo,
      });
      if (r.ok) onSalvo(r.mensagem ?? 'Bloqueio criado');
      else setErro(r.erro);
    });
  }

  return (
    <form className={s.form} onSubmit={salvar}>
      <div className={s.campo}>
        <span className={s.rotulo}>Motivo</span>
        <div className={s.linha} role="group" aria-label="Motivo">
          {MOTIVOS.map((m) => (
            <button key={m.rotulo} type="button" className={s.chip} aria-pressed={motivo === m.rotulo} onClick={() => escolherMotivo(m)}>
              {m.rotulo}
            </button>
          ))}
        </div>
        {motivo === 'Outro' && (
          <input className={s.entrada} placeholder="Descreva (ex.: curso, consulta médica)" value={outro} onChange={(e) => setOutro(e.target.value)} maxLength={80} />
        )}
      </div>

      <div className={s.campo}>
        <label htmlFor="bl-prof">Quem</label>
        <select id="bl-prof" className={s.entrada} value={prof} onChange={(e) => setProf(e.target.value)}>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
          <option value="">Toda a barbearia (fechada)</option>
        </select>
      </div>

      <label className={s.linha} style={{ minHeight: 40 }}>
        <input type="checkbox" checked={inteiro} onChange={(e) => setInteiro(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--acento)' }} />
        Dia inteiro
      </label>

      {inteiro ? (
        <div className={`${s.grade}`} style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className={s.campo}>
            <label htmlFor="bl-de">De</label>
            <input id="bl-de" type="date" className={s.entrada} value={de} min={hoje} onChange={(e) => e.target.value && setDe(e.target.value)} style={{ colorScheme: 'dark' }} />
          </div>
          <div className={s.campo}>
            <label htmlFor="bl-ate">Até</label>
            <input id="bl-ate" type="date" className={s.entrada} value={ate < de ? de : ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} style={{ colorScheme: 'dark' }} />
          </div>
        </div>
      ) : (
        <div className={s.grade} style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}>
          <div className={s.campo}>
            <label htmlFor="bl-dia">Dia</label>
            <input id="bl-dia" type="date" className={s.entrada} value={de} min={hoje} onChange={(e) => e.target.value && setDe(e.target.value)} style={{ colorScheme: 'dark' }} />
          </div>
          <div className={s.campo}>
            <label htmlFor="bl-hi">Das</label>
            <input id="bl-hi" type="time" step={900} className={s.entrada} value={hIni} onChange={(e) => setHIni(e.target.value)} style={{ colorScheme: 'dark' }} />
          </div>
          <div className={s.campo}>
            <label htmlFor="bl-hf">Até</label>
            <input id="bl-hf" type="time" step={900} className={s.entrada} value={hFim} onChange={(e) => setHFim(e.target.value)} style={{ colorScheme: 'dark' }} />
          </div>
        </div>
      )}

      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente}>
        {pendente ? 'Salvando…' : 'Criar bloqueio'}
      </button>
    </form>
  );
}
