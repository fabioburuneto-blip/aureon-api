'use client';

import Link from 'next/link';
import { useState, type RefObject } from 'react';
import type { Profissional, Servico } from '@/lib/barbearia';
import { duracao, iniciais, linkWhatsapp, preco } from '@/lib/formatar';
import {
  dataLonga,
  linkGoogleAgenda,
  mascaraTelefone,
  mensagemWhatsapp,
  validarNome,
  validarTelefone,
  type Confirmacao,
  type HorarioLivre,
} from '@/lib/agendamento';
import { IconeAlerta, IconeCalendario, IconeCheck, IconeGrupo, IconeWhatsapp } from '@/components/site/Icones';
import s from './agendamento.module.css';

type Titulo = { tituloRef: RefObject<HTMLHeadingElement | null> };

function Cabecalho({ tituloRef, titulo, sub }: Titulo & { titulo: string; sub?: string }) {
  return (
    <div className={s.cabecalho}>
      <h1 ref={tituloRef} tabIndex={-1} className={s.titulo}>
        {titulo}
      </h1>
      {sub && <p className={s.sub}>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Serviço
// ---------------------------------------------------------------------------
export function PassoServico({
  tituloRef,
  servicos,
  selecionado,
  onEscolher,
}: Titulo & { servicos: Servico[]; selecionado?: string; onEscolher: (s: Servico) => void }) {
  return (
    <>
      <Cabecalho tituloRef={tituloRef} titulo="Qual serviço?" sub="Escolha o serviço que você quer agendar." />
      {servicos.length === 0 ? (
        <p className={s.vazio}>Nenhum serviço disponível para agendamento online no momento.</p>
      ) : (
        <ul className={s.lista}>
          {servicos.map((sv) => (
            <li key={sv.id}>
              <button
                type="button"
                className={s.opcao}
                aria-pressed={sv.id === selecionado}
                onClick={() => onEscolher(sv)}
              >
                <span className={s.opcaoCorpo}>
                  <span className={s.opcaoNome}>{sv.nome}</span>
                  {sv.descricao && <span className={s.opcaoDescricao}>{sv.descricao}</span>}
                  <span className={s.opcaoMeta}>{duracao(sv.duracao_min)}</span>
                </span>
                <span className={s.opcaoPreco}>{preco(sv.preco)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Profissional
// ---------------------------------------------------------------------------
export function PassoProfissional({
  tituloRef,
  profissionais,
  selecionado,
  onEscolher,
}: Titulo & { profissionais: Profissional[]; selecionado: string | null; onEscolher: (id: string | null) => void }) {
  return (
    <>
      <Cabecalho tituloRef={tituloRef} titulo="Com quem?" sub="Escolha um profissional ou deixe que a gente escolha." />
      <ul className={s.lista}>
        <li>
          <button
            type="button"
            className={`${s.opcao} ${s.opcaoPessoa}`}
            aria-pressed={selecionado === null}
            onClick={() => onEscolher(null)}
          >
            <span className={`${s.avatar} ${s.avatarIcone}`}>
              <IconeGrupo tamanho={26} />
            </span>
            <span className={s.opcaoCorpo}>
              <span className={s.opcaoNome}>Qualquer profissional</span>
              <span className={s.opcaoDescricao}>Mais horários disponíveis</span>
            </span>
          </button>
        </li>
        {profissionais.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={`${s.opcao} ${s.opcaoPessoa}`}
              aria-pressed={selecionado === p.id}
              onClick={() => onEscolher(p.id)}
            >
              <span className={s.avatar}>
                {p.foto_url ? <img src={p.foto_url} alt="" /> : <span>{iniciais(p.nome)}</span>}
              </span>
              <span className={s.opcaoCorpo}>
                <span className={s.opcaoNome}>{p.nome}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Dados do cliente
// ---------------------------------------------------------------------------
export function PassoDados({
  tituloRef,
  nomeInicial,
  telefoneInicial,
  onEnviar,
}: Titulo & { nomeInicial: string; telefoneInicial: string; onEnviar: (nome: string, telefone: string) => void }) {
  const [nome, setNome] = useState(nomeInicial);
  const [telefone, setTelefone] = useState(mascaraTelefone(telefoneInicial));
  const [tocado, setTocado] = useState({ nome: false, telefone: false });

  const erroNome = validarNome(nome);
  const erroTelefone = validarTelefone(telefone);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTocado({ nome: true, telefone: true });
    if (erroNome || erroTelefone) {
      document.getElementById(erroNome ? 'campo-nome' : 'campo-telefone')?.focus();
      return;
    }
    onEnviar(nome.trim(), telefone);
  }

  return (
    <form onSubmit={enviar} noValidate className={s.formulario}>
      <Cabecalho tituloRef={tituloRef} titulo="Seus dados" sub="Sem cadastro e sem senha. Só para confirmarmos seu horário." />

      <div className={s.campo}>
        <label htmlFor="campo-nome">Nome</label>
        <input
          id="campo-nome"
          name="nome"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={100}
          placeholder="Como podemos te chamar?"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => setTocado((t) => ({ ...t, nome: true }))}
          aria-invalid={tocado.nome && !!erroNome}
          aria-describedby={tocado.nome && erroNome ? 'erro-nome' : undefined}
        />
        {tocado.nome && erroNome && (
          <p id="erro-nome" className={s.erroCampo}>
            {erroNome}
          </p>
        )}
      </div>

      <div className={s.campo}>
        <label htmlFor="campo-telefone">WhatsApp</label>
        <input
          id="campo-telefone"
          name="telefone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          enterKeyHint="done"
          placeholder="(11) 91234-5678"
          value={telefone}
          onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
          onBlur={() => setTocado((t) => ({ ...t, telefone: true }))}
          aria-invalid={tocado.telefone && !!erroTelefone}
          aria-describedby={tocado.telefone && erroTelefone ? 'erro-telefone' : 'dica-telefone'}
        />
        {tocado.telefone && erroTelefone ? (
          <p id="erro-telefone" className={s.erroCampo}>
            {erroTelefone}
          </p>
        ) : (
          <p id="dica-telefone" className={s.dica}>
            Com DDD. A barbearia pode te chamar por aqui se precisar.
          </p>
        )}
      </div>

      <div className={s.acoes}>
        <button type="submit" className={s.botao}>
          Continuar
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 5. Revisão
// ---------------------------------------------------------------------------
export function PassoRevisao({
  tituloRef,
  servico,
  nomeProfissional,
  dia,
  horario,
  nome,
  telefone,
  enviando,
  erro,
  whatsappBarbearia,
  nomeBarbearia,
  podeTrocarProfissional,
  onEditar,
  onConfirmar,
}: Titulo & {
  servico: Servico;
  nomeProfissional: string;
  dia: string;
  horario: HorarioLivre;
  nome: string;
  telefone: string;
  enviando: boolean;
  erro: string | null;
  whatsappBarbearia: string | null;
  nomeBarbearia: string;
  podeTrocarProfissional: boolean;
  onEditar: (passo: 'servico' | 'profissional' | 'horario' | 'dados') => void;
  onConfirmar: () => void;
}) {
  const wa = linkWhatsapp(whatsappBarbearia, `Olá, ${nomeBarbearia}! Tentei agendar pelo site e preciso de ajuda.`);
  return (
    <>
      <Cabecalho tituloRef={tituloRef} titulo="Confira e confirme" sub="Está tudo certo?" />

      <dl className={s.resumo}>
        <Linha rotulo="Serviço" valor={servico.nome} extra={`${duracao(servico.duracao_min)} · ${preco(servico.preco)}`} onEditar={() => onEditar('servico')} />
        {nomeProfissional && (
          <Linha
            rotulo="Profissional"
            valor={nomeProfissional}
            extra={nomeProfissional === 'Qualquer profissional' ? 'Definido na confirmação' : undefined}
            onEditar={podeTrocarProfissional ? () => onEditar('profissional') : undefined}
          />
        )}
        <Linha rotulo="Data e horário" valor={`${dataLonga(dia)}`} extra={`às ${horario.hora}`} onEditar={() => onEditar('horario')} />
        <Linha rotulo="Seus dados" valor={nome} extra={telefone} onEditar={() => onEditar('dados')} />
      </dl>

      {erro && (
        <div className={s.alerta} role="alert">
          <IconeAlerta />
          <div>
            <p>{erro}</p>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer">
                Falar com a barbearia
              </a>
            )}
          </div>
        </div>
      )}

      <div className={s.acoes}>
        <button type="button" className={s.botao} onClick={onConfirmar} disabled={enviando} aria-busy={enviando}>
          {enviando ? <span className={s.girando} aria-hidden /> : null}
          {enviando ? 'Confirmando…' : 'Confirmar agendamento'}
        </button>
      </div>
    </>
  );
}

function Linha({ rotulo, valor, extra, onEditar }: { rotulo: string; valor: string; extra?: string; onEditar?: () => void }) {
  return (
    <div className={s.resumoLinha}>
      <div>
        <dt>{rotulo}</dt>
        <dd>
          <span className={s.resumoValor}>{valor}</span>
          {extra && <span className={s.resumoExtra}>{extra}</span>}
        </dd>
      </div>
      {onEditar && (
        <button type="button" className={s.editar} onClick={onEditar} aria-label={`Alterar ${rotulo.toLowerCase()}`}>
          Alterar
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Sucesso
// ---------------------------------------------------------------------------
export function PassoSucesso({ tituloRef, c, slug }: Titulo & { c: Confirmacao; slug: string }) {
  const wa = linkWhatsapp(c.barbearia.whatsapp, mensagemWhatsapp(c));
  const local = [c.barbearia.endereco, c.barbearia.cidade].filter(Boolean).join(' · ');
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(c.agendamento.inicio));

  return (
    <div className={s.sucesso}>
      <span className={s.selo} aria-hidden>
        <IconeCheck tamanho={34} />
      </span>
      <h1 ref={tituloRef} tabIndex={-1} className={s.titulo}>
        Agendamento confirmado!
      </h1>
      <p className={s.sub}>Te esperamos, {c.cliente.nome.split(' ')[0]}.</p>

      <dl className={`${s.resumo} ${s.resumoSucesso}`}>
        <div className={s.resumoLinha}>
          <div>
            <dt>Quando</dt>
            <dd>
              <span className={s.resumoValor}>{dataLonga(dia)}</span>
              <span className={s.resumoExtra}>às {c.agendamento.hora}</span>
            </dd>
          </div>
        </div>
        <div className={s.resumoLinha}>
          <div>
            <dt>Serviço</dt>
            <dd>
              <span className={s.resumoValor}>{c.servico.nome}</span>
              <span className={s.resumoExtra}>
                {duracao(c.servico.duracao_min)} · {preco(c.agendamento.preco)}
              </span>
            </dd>
          </div>
        </div>
        <div className={s.resumoLinha}>
          <div>
            <dt>Profissional</dt>
            <dd>
              <span className={s.resumoValor}>{c.profissional.nome}</span>
            </dd>
          </div>
        </div>
        {local && (
          <div className={s.resumoLinha}>
            <div>
              <dt>Onde</dt>
              <dd>
                <span className={s.resumoValor}>{c.barbearia.nome}</span>
                <span className={s.resumoExtra}>{local}</span>
              </dd>
            </div>
          </div>
        )}
      </dl>

      <div className={s.acoesSucesso}>
        <a className={s.botao} href={linkGoogleAgenda(c)} target="_blank" rel="noopener noreferrer">
          <IconeCalendario /> Adicionar ao Google Agenda
        </a>
        {wa && (
          <a className={s.botaoContorno} href={wa} target="_blank" rel="noopener noreferrer">
            <IconeWhatsapp /> Falar no WhatsApp
          </a>
        )}
        <Link className={s.linkSimples} href={`/${slug}`}>
          Voltar para o site
        </Link>
      </div>
    </div>
  );
}
