'use client';

import { useState, useTransition } from 'react';
import { duracao, preco } from '@/lib/formatar';
import type { ServicoPainel } from '@/lib/painel-tipos';
import { adicionarDoCatalogo, alternarServico, reordenarServicos, salvarServico } from './acoes';
import { Chave, Folha, useAviso } from '@/components/interno/Comuns';
import { IBaixo, ICima, ILapis, IMais } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';
import c from './servicos.module.css';

type Catalogo = { nome: string; duracao_min_sugerida: number };

/** "55,00" / "55" / "55.5" → 55.5 */
const lerPreco = (v: string) => Number(v.replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

export function Servicos({ servicos, catalogo }: { servicos: ServicoPainel[]; catalogo: Catalogo[] }) {
  const [editando, setEditando] = useState<ServicoPainel | 'novo' | null>(null);
  const [catalogoAberto, setCatalogoAberto] = useState(false);
  const [ordem, setOrdem] = useState<string[] | null>(null); // ordem otimista
  const [pendente, iniciar] = useTransition();
  const [aviso, mostrar] = useAviso();

  const lista = ordem ? (ordem.map((id) => servicos.find((x) => x.id === id)).filter(Boolean) as ServicoPainel[]) : servicos;

  function mover(i: number, delta: number) {
    const ids = lista.map((x) => x.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrdem(ids);
    iniciar(async () => {
      const r = await reordenarServicos(ids);
      if (!r.ok) mostrar(r.erro);
      setOrdem(null);
    });
  }

  function alternar(sv: ServicoPainel, ativo: boolean) {
    iniciar(async () => {
      const r = await alternarServico(sv.id, ativo);
      mostrar(r.ok ? (ativo ? `${sv.nome} ativado` : `${sv.nome} desativado`) : r.erro);
    });
  }

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Serviços</h1>
          <p className={s.sub}>O que aparece no site e no agendamento online. Desative em vez de apagar.</p>
        </div>
        <div className={s.linha}>
          <button className={s.botao} onClick={() => setCatalogoAberto(true)}>
            Adicionar do catálogo
          </button>
          <button className={`${s.botao} ${s.primario}`} onClick={() => setEditando('novo')}>
            <IMais tamanho={18} /> Novo serviço
          </button>
        </div>
      </div>

      {lista.length === 0 ? (
        <div className={s.vazio}>
          Nenhum serviço ainda. Comece pelo <strong>catálogo</strong>: marque os que você faz e informe o preço.
        </div>
      ) : (
        <ul className={s.lista}>
          {lista.map((sv, i) => (
            <li key={sv.id} className={`${s.item} ${sv.ativo ? '' : s.itemInativo}`}>
              <div className={c.ordem}>
                <button className={`${s.botao} ${s.fantasma} ${c.seta}`} disabled={i === 0 || pendente} onClick={() => mover(i, -1)} aria-label={`Subir ${sv.nome}`}>
                  <ICima tamanho={18} />
                </button>
                <button className={`${s.botao} ${s.fantasma} ${c.seta}`} disabled={i === lista.length - 1 || pendente} onClick={() => mover(i, 1)} aria-label={`Descer ${sv.nome}`}>
                  <IBaixo tamanho={18} />
                </button>
              </div>
              <div className={s.itemCorpo}>
                <div className={s.itemTitulo}>{sv.nome}</div>
                <div className={s.itemSub}>
                  {duracao(sv.duracao_min)} · <span className={s.num}>{preco(sv.preco)}</span>
                  {!sv.ativo && ' · inativo'}
                </div>
              </div>
              <Chave ligada={sv.ativo} onMudar={(v) => alternar(sv, v)} rotulo={`${sv.ativo ? 'Desativar' : 'Ativar'} ${sv.nome}`} desabilitada={pendente} />
              <button className={`${s.botao} ${s.fantasma} ${s.icone}`} onClick={() => setEditando(sv)} aria-label={`Editar ${sv.nome}`}>
                <ILapis tamanho={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Folha aberta={editando !== null} titulo={editando === 'novo' ? 'Novo serviço' : 'Editar serviço'} onFechar={() => setEditando(null)}>
        {editando !== null && (
          <FormServico
            servico={editando === 'novo' ? null : editando}
            onSalvo={(t) => {
              setEditando(null);
              mostrar(t);
            }}
          />
        )}
      </Folha>

      <Folha aberta={catalogoAberto} titulo="Adicionar do catálogo" onFechar={() => setCatalogoAberto(false)}>
        {catalogoAberto && (
          <FormCatalogo
            catalogo={catalogo}
            existentes={servicos.map((x) => x.nome.toLowerCase())}
            onSalvo={(t) => {
              setCatalogoAberto(false);
              mostrar(t);
            }}
          />
        )}
      </Folha>
      {aviso}
    </>
  );
}

function FormServico({ servico, onSalvo }: { servico: ServicoPainel | null; onSalvo: (t: string) => void }) {
  const [nome, setNome] = useState(servico?.nome ?? '');
  const [descricao, setDescricao] = useState(servico?.descricao ?? '');
  const [valor, setValor] = useState(servico ? String(servico.preco).replace('.', ',') : '');
  const [minutos, setMinutos] = useState(String(servico?.duracao_min ?? 30));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await salvarServico({ id: servico?.id, nome, descricao, preco: lerPreco(valor), duracao_min: Number(minutos) });
      if (r.ok) onSalvo(servico ? 'Serviço atualizado' : 'Serviço criado');
      else setErro(r.erro);
    });
  }

  return (
    <form className={s.form} onSubmit={salvar}>
      <div className={s.campo}>
        <label htmlFor="sv-nome">Nome</label>
        <input id="sv-nome" className={s.entrada} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required autoFocus />
      </div>
      <div className={`${s.grade} ${c.dupla}`}>
        <div className={s.campo}>
          <label htmlFor="sv-preco">Preço (R$)</label>
          <input id="sv-preco" className={s.entrada} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} required />
        </div>
        <div className={s.campo}>
          <label htmlFor="sv-min">Duração (min)</label>
          <input id="sv-min" className={s.entrada} type="number" inputMode="numeric" min={5} max={720} step={5} value={minutos} onChange={(e) => setMinutos(e.target.value)} required />
        </div>
      </div>
      <div className={s.campo}>
        <label htmlFor="sv-desc">Descrição (opcional)</label>
        <textarea id="sv-desc" className={s.entrada} maxLength={300} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Aparece no site, abaixo do nome." />
      </div>
      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente}>
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

function FormCatalogo({ catalogo, existentes, onSalvo }: { catalogo: Catalogo[]; existentes: string[]; onSalvo: (t: string) => void }) {
  const [marcados, setMarcados] = useState<Record<string, { preco: string; minutos: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const qtd = Object.keys(marcados).length;

  function marcar(item: Catalogo, sim: boolean) {
    setMarcados((m) => {
      const n = { ...m };
      if (sim) n[item.nome] = { preco: '', minutos: String(item.duracao_min_sugerida) };
      else delete n[item.nome];
      return n;
    });
  }

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const itens = Object.entries(marcados).map(([nome, v]) => ({ nome, preco: lerPreco(v.preco), duracao_min: Number(v.minutos) }));
    const semPreco = itens.find((i) => !Number.isFinite(i.preco) || marcados[i.nome].preco.trim() === '');
    if (semPreco) return setErro(`Informe o preço de ${semPreco.nome}.`);
    setErro(null);
    iniciar(async () => {
      const r = await adicionarDoCatalogo(itens);
      if (r.ok) onSalvo(r.mensagem ?? 'Serviços adicionados');
      else setErro(r.erro);
    });
  }

  return (
    <form className={s.form} onSubmit={adicionar}>
      <p className={`${s.pequeno} ${s.suave}`}>Marque os serviços que você faz, confira a duração e digite o preço.</p>
      <ul className={c.catalogo}>
        {[...catalogo]
          .sort((x, y) => Number(existentes.includes(x.nome.toLowerCase())) - Number(existentes.includes(y.nome.toLowerCase())))
          .map((item) => {
          const ja = existentes.includes(item.nome.toLowerCase());
          const m = marcados[item.nome];
          return (
            <li key={item.nome} className={`${c.catItem} ${m ? c.catMarcado : ''} ${ja ? c.catJa : ''}`}>
              <label className={c.catRotulo}>
                <input type="checkbox" checked={!!m} disabled={ja} onChange={(e) => marcar(item, e.target.checked)} />
                <span>
                  <strong>{item.nome}</strong>
                  <span className={`${s.pequeno} ${s.fraco}`}>{ja ? ' · já cadastrado' : ` · ${duracao(item.duracao_min_sugerida)}`}</span>
                </span>
              </label>
              {m && (
                <div className={c.catCampos}>
                  <label>
                    <span className="sr-only">Preço de {item.nome}</span>
                    <span className={c.prefixo}>R$</span>
                    <input
                      className={s.entrada}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={m.preco}
                      autoFocus
                      onChange={(e) => setMarcados((x) => ({ ...x, [item.nome]: { ...x[item.nome], preco: e.target.value } }))}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Duração de {item.nome} em minutos</span>
                    <input
                      className={s.entrada}
                      type="number"
                      inputMode="numeric"
                      min={5}
                      step={5}
                      value={m.minutos}
                      onChange={(e) => setMarcados((x) => ({ ...x, [item.nome]: { ...x[item.nome], minutos: e.target.value } }))}
                    />
                    <span className={c.sufixo}>min</span>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={!qtd || pendente}>
        {pendente ? 'Adicionando…' : qtd ? `Adicionar ${qtd} ${qtd === 1 ? 'serviço' : 'serviços'}` : 'Marque os serviços'}
      </button>
    </form>
  );
}
