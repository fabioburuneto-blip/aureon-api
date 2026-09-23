'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Layout, Profissional, Servico } from '@/lib/barbearia';
import {
  CODIGOS_HORARIO,
  lerClienteSalvo,
  salvarCliente,
  soDigitos,
  type Confirmacao,
  type HorarioLivre,
} from '@/lib/agendamento';
import { confirmarAgendamento, listarHorarios } from '@/app/[slug]/agendar/acoes';
import { IconeVoltar } from '@/components/site/Icones';
import { PassoDados, PassoProfissional, PassoRevisao, PassoServico, PassoSucesso } from './Passos';
import { PassoHorario } from './PassoHorario';
import s from './agendamento.module.css';

export type DadosBarbearia = {
  slug: string;
  nome: string;
  logoUrl: string;
  whatsapp: string | null;
  endereco: string | null;
  cidade: string | null;
  layout: Layout;
  servicos: Servico[];
  profissionais: Profissional[];
};

type Passo = 'servico' | 'profissional' | 'horario' | 'dados' | 'revisao' | 'sucesso';

const ROTULOS: Record<Passo, string> = {
  servico: 'Serviço',
  profissional: 'Profissional',
  horario: 'Data e horário',
  dados: 'Seus dados',
  revisao: 'Confirmação',
  sucesso: 'Pronto',
};

const MSG_OCUPADO = 'Poxa, esse horário acabou de ser ocupado. Escolha outro horário, por favor.';

export function Agendamento({ b }: { b: DadosBarbearia }) {
  const umProfissional = b.profissionais.length === 1;
  const passos: Passo[] = umProfissional
    ? ['servico', 'horario', 'dados', 'revisao']
    : ['servico', 'profissional', 'horario', 'dados', 'revisao'];

  const [passo, setPasso] = useState<Passo>('servico');
  const [servico, setServico] = useState<Servico | null>(null);
  // null = "Qualquer profissional"; com um só profissional, já vem escolhido
  const [profissionalId, setProfissionalId] = useState<string | null>(umProfissional ? b.profissionais[0].id : null);
  const [dia, setDia] = useState<string | null>(null);
  const [horario, setHorario] = useState<HorarioLivre | null>(null);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [versaoAgenda, setVersaoAgenda] = useState(0); // força recarregar dias/horários
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);

  const tituloRef = useRef<HTMLHeadingElement>(null);
  const confirmado = useRef(false);
  const primeiraRenderizacao = useRef(true);

  // ---- histórico: cada passo é uma entrada, então o "voltar" do celular funciona ----
  // (a entrada inicial é do roteador do Next; sem "passo" nela = primeiro passo)
  useEffect(() => {
    const aoVoltar = (e: PopStateEvent) => {
      if (confirmado.current) {
        // depois de confirmado, voltar leva ao site (não reabre a confirmação)
        window.location.href = `/${b.slug}`;
        return;
      }
      const p = e.state?.passo as Passo | undefined;
      setPasso(p && ROTULOS[p] ? p : 'servico');
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [b.slug]);

  useEffect(() => {
    const salvo = lerClienteSalvo();
    if (salvo) {
      setNome(salvo.nome);
      setTelefone(salvo.telefone);
    }
  }, []);

  // foco e rolagem no topo a cada passo (leitores de tela anunciam o novo título)
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    tituloRef.current?.focus({ preventScroll: true });
  }, [passo]);

  const irPara = useCallback((p: Passo) => {
    history.pushState({ passo: p }, '');
    setPasso(p);
  }, []);

  const proximoDe = (p: Passo): Passo => passos[passos.indexOf(p) + 1] ?? 'revisao';

  /** Volta N passos pelo histórico (mantém a pilha do navegador coerente). */
  const voltarPara = useCallback(
    (alvo: Passo) => {
      const delta = passos.indexOf(passo) - passos.indexOf(alvo);
      if (delta > 0) history.go(-delta);
      else setPasso(alvo);
    },
    [passo, passos],
  );

  const horarioOcupado = useCallback(() => {
    setAviso(MSG_OCUPADO);
    setHorario(null);
    setVersaoAgenda((v) => v + 1);
    voltarPara('horario');
  }, [voltarPara]);

  // ---- ações de cada passo ----
  function escolherServico(sv: Servico) {
    if (sv.id !== servico?.id) {
      setServico(sv);
      setHorario(null);
    }
    setAviso(null);
    irPara(proximoDe('servico'));
  }

  function escolherProfissional(id: string | null) {
    if (id !== profissionalId) {
      setProfissionalId(id);
      setHorario(null);
    }
    setAviso(null);
    irPara('horario');
  }

  function escolherHorario(h: HorarioLivre) {
    setHorario(h);
    setAviso(null);
    irPara('dados');
  }

  function enviarDados(n: string, t: string) {
    setNome(n);
    setTelefone(t);
    setErro(null);
    irPara('revisao');
  }

  // Ao chegar na revisão, confere se o horário continua livre
  useEffect(() => {
    if (passo !== 'revisao' || !servico || !horario || !dia) return;
    let ativo = true;
    listarHorarios(b.slug, servico.id, profissionalId, dia).then((r) => {
      if (!ativo || !r.ok) return;
      const aindaLivre = r.dados.some((h) => Date.parse(h.inicio) === Date.parse(horario.inicio));
      if (!aindaLivre) horarioOcupado();
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo]);

  async function confirmar() {
    if (!servico || !horario || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await confirmarAgendamento({
        slug: b.slug,
        servicoId: servico.id,
        profissionalId,
        inicio: horario.inicio,
        nome: nome.trim(),
        telefone: soDigitos(telefone),
      });
      if (r.ok) {
        confirmado.current = true;
        salvarCliente(nome.trim(), telefone);
        setConfirmacao(r);
        history.pushState({ passo: 'sucesso' }, '');
        setPasso('sucesso');
      } else if (CODIGOS_HORARIO.includes(r.codigo)) {
        horarioOcupado();
      } else {
        setErro(r.mensagem);
      }
    } catch {
      setErro('Sem conexão com a internet. Verifique e tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  // ---- renderização ----
  const indice = passos.indexOf(passo);
  const total = passos.length;
  const nomeProfissional =
    profissionalId === null
      ? 'Qualquer profissional'
      : (b.profissionais.find((p) => p.id === profissionalId)?.nome ?? '');

  return (
    <div className={s.fluxo} data-layout={b.layout}>
      <header className={s.topo}>
        <div className={s.topoLinha}>
          {passo === 'servico' || passo === 'sucesso' ? (
            <Link className={s.voltar} href={`/${b.slug}`} aria-label="Voltar para o site">
              <IconeVoltar />
            </Link>
          ) : (
            <button type="button" className={s.voltar} onClick={() => history.back()} aria-label="Voltar">
              <IconeVoltar />
            </button>
          )}
          <Link href={`/${b.slug}`} className={s.marca}>
            {b.logoUrl && <img src={b.logoUrl} alt="" width={28} height={28} />}
            <span>{b.nome}</span>
          </Link>
          <span className={s.topoEspaco} aria-hidden />
        </div>
        {passo !== 'sucesso' && (
          <div className={s.progresso}>
            <p className={s.progressoTexto}>
              <span>
                Passo {indice + 1} de {total}
              </span>
              <span>{ROTULOS[passo]}</span>
            </p>
            <div
              className={s.barra}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={indice + 1}
              aria-label="Progresso do agendamento"
            >
              <span style={{ width: `${((indice + 1) / total) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      <main className={s.conteudo} key={passo}>
        {passo === 'servico' && (
          <PassoServico tituloRef={tituloRef} servicos={b.servicos} selecionado={servico?.id} onEscolher={escolherServico} />
        )}

        {passo === 'profissional' && (
          <PassoProfissional
            tituloRef={tituloRef}
            profissionais={b.profissionais}
            selecionado={profissionalId}
            onEscolher={escolherProfissional}
          />
        )}

        {passo === 'horario' && servico && (
          <PassoHorario
            tituloRef={tituloRef}
            slug={b.slug}
            servico={servico}
            profissionalId={profissionalId}
            nomeProfissional={nomeProfissional}
            dia={dia}
            onDia={setDia}
            horarioSelecionado={horario?.inicio ?? null}
            onEscolher={escolherHorario}
            aviso={aviso}
            versao={versaoAgenda}
          />
        )}

        {passo === 'dados' && (
          <PassoDados tituloRef={tituloRef} nomeInicial={nome} telefoneInicial={telefone} onEnviar={enviarDados} />
        )}

        {passo === 'revisao' && servico && horario && dia && (
          <PassoRevisao
            tituloRef={tituloRef}
            servico={servico}
            nomeProfissional={nomeProfissional}
            dia={dia}
            horario={horario}
            nome={nome}
            telefone={telefone}
            enviando={enviando}
            erro={erro}
            whatsappBarbearia={b.whatsapp}
            nomeBarbearia={b.nome}
            podeTrocarProfissional={!umProfissional}
            onEditar={(p) => voltarPara(p)}
            onConfirmar={confirmar}
          />
        )}

        {passo === 'sucesso' && confirmacao && (
          <PassoSucesso tituloRef={tituloRef} c={confirmacao} slug={b.slug} />
        )}

        {/* estado inconsistente (ex.: recarregou no meio): recomeça */}
        {((passo === 'horario' && !servico) || (passo === 'revisao' && (!servico || !horario || !dia)) || (passo === 'sucesso' && !confirmacao)) && (
          <Recomecar slug={b.slug} />
        )}
      </main>
    </div>
  );
}

function Recomecar({ slug }: { slug: string }) {
  return (
    <div className={s.vazio}>
      <p>Vamos recomeçar o agendamento.</p>
      <a className={s.botao} href={`/${slug}/agendar`}>
        Recomeçar
      </a>
    </div>
  );
}
