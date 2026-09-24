'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import type { Layout, ParFontes, Tema } from '@/lib/barbearia';
import { PARES_FONTES } from '@/lib/tema';
import { enviarImagem } from '@/lib/supabase-navegador';
import { salvarTema } from '../../../../acoes';
import { useAviso } from '@/components/interno/Comuns';
import { FotoUpload } from '@/components/interno/FotoUpload';
import { ICelular, IEsquerda, IExterno, IFechar, IMais, IMonitor } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';
import e from './editor-tema.module.css';

const LAYOUTS: { id: Layout; nome: string; desc: string }[] = [
  { id: 'luxo', nome: 'Luxo', desc: 'Escuro, elegante, detalhes finos' },
  { id: 'classico', nome: 'Clássico', desc: 'Vintage, molduras e ornamentos' },
  { id: 'urbano', nome: 'Urbano', desc: 'Street, letras grandes, contraste' },
  { id: 'minimalista', nome: 'Minimalista', desc: 'Claro, limpo, foco nas fotos' },
];

const FONTES: { id: ParFontes; nome: string }[] = [
  { id: 'elegante', nome: 'Elegante' },
  { id: 'moderna', nome: 'Moderna' },
  { id: 'classica', nome: 'Clássica' },
  { id: 'impacto', nome: 'Impacto' },
];

type Cores = Pick<Tema, 'cor_primaria' | 'cor_destaque' | 'cor_fundo' | 'cor_texto'>;
const PALETAS: { nome: string; cores: Cores }[] = [
  { nome: 'Dourado noturno', cores: { cor_fundo: '#0E0E0E', cor_primaria: '#1A1A1A', cor_destaque: '#C9A24D', cor_texto: '#F5F1E8' } },
  { nome: 'Vintage', cores: { cor_fundo: '#F3EBDD', cor_primaria: '#3B2A20', cor_destaque: '#9E2B25', cor_texto: '#2A1E17' } },
  { nome: 'Neon', cores: { cor_fundo: '#111111', cor_primaria: '#1E1E1E', cor_destaque: '#E4FF3A', cor_texto: '#FFFFFF' } },
  { nome: 'Papel', cores: { cor_fundo: '#FAFAF7', cor_primaria: '#ECEBE6', cor_destaque: '#1F1F1F', cor_texto: '#1A1A1A' } },
  { nome: 'Marinho', cores: { cor_fundo: '#0F1B2D', cor_primaria: '#16263D', cor_destaque: '#E8B04B', cor_texto: '#EEF2F7' } },
  { nome: 'Verde garrafa', cores: { cor_fundo: '#0E1F17', cor_primaria: '#163024', cor_destaque: '#D9C38C', cor_texto: '#F1EEE4' } },
];

const CAMPOS_COR: { chave: keyof Cores; nome: string; dica: string }[] = [
  { chave: 'cor_fundo', nome: 'Fundo', dica: 'Cor de fundo da página' },
  { chave: 'cor_texto', nome: 'Texto', dica: 'Textos principais' },
  { chave: 'cor_destaque', nome: 'Destaque', dica: 'Botões, preços e detalhes' },
  { chave: 'cor_primaria', nome: 'Primária', dica: 'Blocos e superfícies' },
];

const HEX = /^#([0-9a-f]{6})$/i;

function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a: string, b: string) {
  if (!HEX.test(a) || !HEX.test(b)) return 21;
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const urlTodasFontes = `https://fonts.googleapis.com/css2?${[...new Set(Object.values(PARES_FONTES).flatMap((p) => p.familias))]
  .map((f) => `family=${f}`)
  .join('&')}&display=swap`;

export function EditorTema({ id, slug, nome, temaSalvo }: { id: string; slug: string; nome: string; temaSalvo: Tema }) {
  const [tema, setTema] = useState<Tema>(temaSalvo);
  const [base, setBase] = useState<Tema>(temaSalvo);
  const [aba, setAba] = useState<'editar' | 'previa'>('editar');
  const [aparelho, setAparelho] = useState<'celular' | 'computador'>('celular');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [aviso, mostrar] = useAviso();
  const iframe = useRef<HTMLIFrameElement>(null);
  const alterado = JSON.stringify(tema) !== JSON.stringify(base);

  const mudar = <K extends keyof Tema>(k: K, v: Tema[K]) => setTema((t) => ({ ...t, [k]: v }));

  // ---- envio do rascunho para o iframe ----
  const enviar = useCallback((t: Tema) => iframe.current?.contentWindow?.postMessage({ tipo: 'tema', tema: t }, location.origin), []);
  useEffect(() => {
    const pronto = (ev: MessageEvent) => {
      if (ev.origin === location.origin && ev.data?.tipo === 'previa-pronta') enviar(temaRef.current);
    };
    window.addEventListener('message', pronto);
    return () => window.removeEventListener('message', pronto);
  }, [enviar]);
  const temaRef = useRef(tema);
  temaRef.current = tema;
  useEffect(() => {
    const t = setTimeout(() => enviar(tema), 60);
    return () => clearTimeout(t);
  }, [tema, enviar]);

  // aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!alterado) return;
    const antes = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [alterado]);

  function salvar() {
    setErro(null);
    iniciar(async () => {
      const r = await salvarTema(id, tema);
      if (!r.ok) return setErro(r.erro);
      setBase(tema);
      mostrar('Tema salvo: o site já está atualizado');
    });
  }

  const baixoContraste = contraste(tema.cor_texto, tema.cor_fundo) < 4.5;

  return (
    <div className={e.editor}>
      <link rel="stylesheet" href={urlTodasFontes} precedence="fontes-editor" />

      <div className={e.topo}>
        <div style={{ minWidth: 0 }}>
          <Link href={`/admin/barbearias/${id}`} className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`} style={{ marginLeft: -12 }}>
            <IEsquerda tamanho={18} /> {nome}
          </Link>
          <h1 className={s.titulo}>Tema do site</h1>
        </div>
        <div className={e.abas} role="tablist" aria-label="Painel">
          <button role="tab" aria-selected={aba === 'editar'} onClick={() => setAba('editar')}>
            Editar
          </button>
          <button role="tab" aria-selected={aba === 'previa'} onClick={() => setAba('previa')}>
            Pré-visualizar
          </button>
        </div>
      </div>

      <div className={e.grade}>
        {/* ------------------------- CONTROLES ------------------------- */}
        <div className={`${e.controles} ${aba === 'editar' ? '' : e.oculto}`}>
          <section className={e.secao}>
            <h2>Layout</h2>
            <div className={e.opcoes2}>
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className={e.opcao} aria-pressed={tema.layout === l.id} onClick={() => mudar('layout', l.id)}>
                  <MiniLayout layout={l.id} tema={tema} />
                  <strong>{l.nome}</strong>
                  <span>{l.desc}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={e.secao}>
            <h2>Cores</h2>
            <div className={e.paletas}>
              {PALETAS.map((p) => (
                <button key={p.nome} type="button" className={e.paleta} onClick={() => setTema((t) => ({ ...t, ...p.cores }))} title={p.nome} aria-label={`Paleta ${p.nome}`}>
                  <span style={{ background: p.cores.cor_fundo }}>
                    <i style={{ background: p.cores.cor_destaque }} />
                    <i style={{ background: p.cores.cor_texto }} />
                  </span>
                  {p.nome}
                </button>
              ))}
            </div>
            <div className={e.cores}>
              {CAMPOS_COR.map((c) => (
                <label key={c.chave} className={e.cor}>
                  <input type="color" value={HEX.test(tema[c.chave]) ? tema[c.chave] : '#000000'} onChange={(ev) => mudar(c.chave, ev.target.value.toUpperCase())} aria-label={`Cor ${c.nome}`} />
                  <span>
                    <strong>{c.nome}</strong>
                    <input
                      className={e.hex}
                      value={tema[c.chave]}
                      maxLength={7}
                      spellCheck={false}
                      aria-label={`Código da cor ${c.nome}`}
                      onChange={(ev) => {
                        const v = ev.target.value.startsWith('#') ? ev.target.value : `#${ev.target.value}`;
                        if (/^#[0-9a-f]{0,6}$/i.test(v)) mudar(c.chave, v.toUpperCase());
                      }}
                    />
                  </span>
                </label>
              ))}
            </div>
            {baixoContraste && <p className={e.alertaCor}>Pouco contraste entre texto e fundo: pode ficar difícil de ler no celular.</p>}
          </section>

          <section className={e.secao}>
            <h2>Fontes</h2>
            <div className={e.opcoes2}>
              {FONTES.map((f) => {
                const par = PARES_FONTES[f.id];
                return (
                  <button key={f.id} type="button" className={e.opcao} aria-pressed={tema.par_fontes === f.id} onClick={() => mudar('par_fontes', f.id)}>
                    <span className={e.amostraTitulo} style={{ fontFamily: `'${par.titulo}', serif` }}>
                      Barbearia
                    </span>
                    <span style={{ fontFamily: `'${par.texto}', sans-serif` }}>
                      {par.titulo} + {par.texto}
                    </span>
                    <strong className={e.fonteNome}>{f.nome}</strong>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={e.secao}>
            <h2>Imagens</h2>
            <div className={s.form}>
              <FotoUpload barbeariaId={id} pasta="tema" url={tema.logo_url || null} onMudar={(u) => mudar('logo_url', u ?? '')} formato="quadrado" rotulo="Logo" max={800} />
              <FotoUpload barbeariaId={id} pasta="tema" url={tema.foto_capa_url || null} onMudar={(u) => mudar('foto_capa_url', u ?? '')} formato="largo" rotulo="Foto de capa" max={2200} />
              <Galeria id={id} fotos={tema.galeria} onMudar={(g) => mudar('galeria', g)} />
            </div>
          </section>

          <section className={e.secao}>
            <h2>Textos</h2>
            <div className={s.form}>
              <div className={s.campo}>
                <label htmlFor="t-titulo">Título do topo</label>
                <input id="t-titulo" className={s.entrada} value={tema.titulo_hero} placeholder={nome} maxLength={90} onChange={(ev) => mudar('titulo_hero', ev.target.value)} />
                <span className={s.dica}>Vazio = nome da barbearia.</span>
              </div>
              <div className={s.campo}>
                <label htmlFor="t-sub">Subtítulo</label>
                <input id="t-sub" className={s.entrada} value={tema.subtitulo_hero} maxLength={200} onChange={(ev) => mudar('subtitulo_hero', ev.target.value)} />
                <span className={s.dica}>Aparece também na prévia do link no WhatsApp.</span>
              </div>
              <div className={s.campo}>
                <label htmlFor="t-sobre">Sobre</label>
                <textarea id="t-sobre" className={s.entrada} rows={7} value={tema.texto_sobre} maxLength={2000} onChange={(ev) => mudar('texto_sobre', ev.target.value)} />
                <span className={s.dica}>Deixe uma linha em branco para separar parágrafos. Vazio = seção escondida.</span>
              </div>
            </div>
          </section>
        </div>

        {/* ------------------------- PRÉVIA ------------------------- */}
        <div className={`${e.previa} ${aba === 'previa' ? '' : e.ocultoMovel}`}>
          <div className={e.previaBarra}>
            <div className={e.aparelhos} role="group" aria-label="Tamanho da prévia">
              <button aria-pressed={aparelho === 'celular'} onClick={() => setAparelho('celular')} aria-label="Celular" title="Celular">
                <ICelular tamanho={18} />
              </button>
              <button aria-pressed={aparelho === 'computador'} onClick={() => setAparelho('computador')} aria-label="Computador" title="Computador">
                <IMonitor tamanho={18} />
              </button>
            </div>
            <span className={`${s.pequeno} ${s.fraco}`}>{alterado ? 'Prévia do rascunho (não salvo)' : 'Igual ao site publicado'}</span>
            <a href={`/${slug}`} target="_blank" rel="noopener noreferrer" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`}>
              <IExterno tamanho={16} /> Site
            </a>
          </div>
          <Moldura aparelho={aparelho}>
            <iframe ref={iframe} src={`/admin/previa/${id}`} title="Pré-visualização do site" className={e.iframe} />
          </Moldura>
        </div>
      </div>

      <div className={e.salvar} data-visivel={alterado || salvando || !!erro}>
        {erro ? <span className={s.erro}>{erro}</span> : <span className={s.suave}>{salvando ? 'Salvando…' : 'Alterações não salvas'}</span>}
        <div className={s.linha} style={{ flexWrap: 'nowrap' }}>
          <button className={`${s.botao} ${s.fantasma}`} onClick={() => setTema(base)} disabled={salvando || !alterado}>
            Descartar
          </button>
          <button className={`${s.botao} ${s.primario}`} onClick={salvar} disabled={salvando || !alterado}>
            Salvar tema
          </button>
        </div>
      </div>
      {aviso}
    </div>
  );
}

/** Ajusta o iframe (390px no celular, 1280px no computador) ao espaço disponível. */
function Moldura({ aparelho, children }: { aparelho: 'celular' | 'computador'; children: React.ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([en]) => setDim({ w: en.contentRect.width, h: en.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const largura = aparelho === 'celular' ? 390 : 1280;
  const altura = aparelho === 'celular' ? 844 : 800;
  const escala = dim.w ? Math.min(1, (dim.w - 24) / largura, aparelho === 'celular' ? (dim.h - 28) / altura : 1) : 1;
  const alturaFinal = aparelho === 'celular' ? altura : dim.h / escala;
  return (
    <div ref={caixa} className={e.moldura}>
      <div
        className={`${e.tela} ${aparelho === 'celular' ? e.telaCelular : ''}`}
        style={{ width: largura, height: alturaFinal, transform: `scale(${escala})` }}
      >
        {children}
      </div>
    </div>
  );
}

function Galeria({ id, fotos, onMudar }: { id: string; fotos: string[]; onMudar: (g: string[]) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const atual = useRef(fotos);
  atual.current = fotos;

  async function adicionar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro(null);
    const lista = Array.from(arquivos).slice(0, 24 - fotos.length);
    setEnviando(lista.length);
    for (const arq of lista) {
      try {
        const url = await enviarImagem(id, 'galeria', arq, 1600);
        atual.current = [...atual.current, url];
        onMudar(atual.current);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Falha no envio.');
      }
      setEnviando((n) => n - 1);
    }
    if (entrada.current) entrada.current.value = '';
  }

  const mover = (i: number, d: number) => {
    const g = [...fotos];
    const j = i + d;
    if (j < 0 || j >= g.length) return;
    [g[i], g[j]] = [g[j], g[i]];
    onMudar(g);
  };

  return (
    <div className={s.campo}>
      <span className={s.rotulo}>
        Galeria <span className={s.fraco}>· {fotos.length}/24 · vazia = seção escondida</span>
      </span>
      <div className={e.galeria}>
        {fotos.map((u, i) => (
          <div key={u + i} className={e.galeriaItem}>
            <img src={u} alt={`Foto ${i + 1}`} />
            <div className={e.galeriaAcoes}>
              <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover para a esquerda">
                ‹
              </button>
              <button type="button" onClick={() => onMudar(fotos.filter((_, j) => j !== i))} aria-label={`Remover foto ${i + 1}`}>
                <IFechar tamanho={14} />
              </button>
              <button type="button" onClick={() => mover(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover para a direita">
                ›
              </button>
            </div>
          </div>
        ))}
        {Array.from({ length: enviando }, (_, i) => (
          <div key={`env-${i}`} className={`${e.galeriaItem} ${e.galeriaEnviando}`}>
            <span className={s.girando} />
          </div>
        ))}
        {fotos.length + enviando < 24 && (
          <button type="button" className={e.galeriaMais} onClick={() => entrada.current?.click()} disabled={enviando > 0}>
            <IMais />
            <span>Fotos</span>
          </button>
        )}
      </div>
      {erro && <span className={s.erro}>{erro}</span>}
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(ev) => adicionar(ev.target.files)} />
    </div>
  );
}

/** Miniatura esquemática do layout com as cores atuais. */
function MiniLayout({ layout, tema }: { layout: Layout; tema: Tema }) {
  const f = tema.cor_fundo, t = tema.cor_texto, d = tema.cor_destaque, p = tema.cor_primaria;
  return (
    <svg viewBox="0 0 80 50" className={e.mini} aria-hidden>
      <rect width="80" height="50" rx="4" fill={f} />
      {layout === 'luxo' && (
        <>
          <rect x="0" y="0" width="80" height="26" fill={p} />
          <rect x="30" y="8" width="20" height="2" fill={d} />
          <rect x="22" y="13" width="36" height="4" rx="1" fill={t} />
          <rect x="32" y="20" width="16" height="3" fill={d} />
          <rect x="18" y="32" width="44" height="1" fill={d} opacity=".6" />
          <rect x="18" y="37" width="44" height="1" fill={t} opacity=".3" />
          <rect x="18" y="42" width="44" height="1" fill={t} opacity=".3" />
        </>
      )}
      {layout === 'classico' && (
        <>
          <rect x="0" y="0" width="80" height="3" fill={d} />
          <circle cx="40" cy="12" r="5" fill={p} />
          <rect x="24" y="20" width="32" height="3" fill={p === f ? t : p} />
          <rect x="30" y="26" width="20" height="3" rx="1" fill={d} />
          <rect x="10" y="33" width="60" height="14" rx="1" fill={p} stroke={d} strokeWidth=".6" />
        </>
      )}
      {layout === 'urbano' && (
        <>
          <rect x="6" y="6" width="34" height="8" fill={t} />
          <rect x="6" y="16" width="26" height="8" fill={t} />
          <rect x="44" y="8" width="30" height="20" fill={p} stroke={d} strokeWidth="2" />
          <rect x="6" y="28" width="24" height="5" fill={d} />
          <rect x="-2" y="37" width="84" height="6" fill={d} transform="rotate(-3 40 40)" />
        </>
      )}
      {layout === 'minimalista' && (
        <>
          <rect x="6" y="5" width="68" height="24" rx="2" fill={p} />
          <rect x="6" y="33" width="30" height="4" fill={t} />
          <rect x="52" y="33" width="22" height="5" rx="2.5" fill={d} />
          <rect x="6" y="42" width="68" height=".7" fill={t} opacity=".3" />
        </>
      )}
    </svg>
  );
}
