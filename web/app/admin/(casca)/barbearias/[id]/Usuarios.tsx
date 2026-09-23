'use client';

import { useState, useTransition } from 'react';
import { criarUsuario } from '../../../acoes';
import { Folha, useAviso } from '@/components/interno/Comuns';
import { IMais } from '@/components/interno/Icones';
import { iniciais } from '@/lib/formatar';
import s from '@/components/interno/ui.module.css';

export type UsuarioLinha = { id: string; nome: string; papel: string; email: string | null };

function senhaAleatoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const v = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(v, (n) => letras[n % letras.length]).join('');
}

export function Usuarios({ barbeariaId, usuarios }: { barbeariaId: string; usuarios: UsuarioLinha[] }) {
  const [aberto, setAberto] = useState(false);
  const [aviso, mostrar] = useAviso();
  const temDono = usuarios.some((u) => u.papel === 'dono');

  return (
    <>
      {usuarios.length === 0 ? (
        <div className={s.vazio} style={{ maxWidth: 720 }}>
          Nenhum usuário ainda. Crie o acesso do dono para ele entrar no painel.
        </div>
      ) : (
        <ul className={s.lista} style={{ maxWidth: 720 }}>
          {usuarios.map((u) => (
            <li key={u.id} className={s.item}>
              <span className={s.avatar}>{iniciais(u.nome)}</span>
              <div className={s.itemCorpo}>
                <div className={s.itemTitulo}>{u.nome}</div>
                <div className={s.itemSub}>{u.email ?? '—'}</div>
              </div>
              <span className={s.badge} style={u.papel === 'dono' ? { color: 'var(--acento)' } : undefined}>
                {u.papel === 'dono' ? 'Dono' : 'Barbeiro'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button className={`${s.botao} ${temDono ? '' : s.primario}`} style={{ marginTop: 12 }} onClick={() => setAberto(true)}>
        <IMais tamanho={18} /> {temDono ? 'Novo usuário' : 'Criar usuário do dono'}
      </button>
      <Folha aberta={aberto} titulo="Novo usuário" onFechar={() => setAberto(false)}>
        {aberto && (
          <FormUsuario
            barbeariaId={barbeariaId}
            papelInicial={temDono ? 'barbeiro' : 'dono'}
            onCriado={(t) => {
              setAberto(false);
              mostrar(t);
            }}
          />
        )}
      </Folha>
      {aviso}
    </>
  );
}

function FormUsuario({ barbeariaId, papelInicial, onCriado }: { barbeariaId: string; papelInicial: 'dono' | 'barbeiro'; onCriado: (t: string) => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState(senhaAleatoria);
  const [papel, setPapel] = useState<'dono' | 'barbeiro'>(papelInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  if (criado) {
    return (
      <div className={s.form}>
        <p className={`${s.alerta} ${s.alertaOk}`}>Usuário criado! Envie os dados de acesso para {nome.split(' ')[0]}:</p>
        <pre className={s.card} style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: 0 }}>{criado}</pre>
        <button className={`${s.botao} ${s.primario}`} onClick={() => navigator.clipboard.writeText(criado).then(() => onCriado('Dados de acesso copiados'))}>
          Copiar dados de acesso
        </button>
        <button className={s.botao} onClick={() => onCriado('Usuário criado')}>
          Concluir
        </button>
      </div>
    );
  }

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        iniciar(async () => {
          const r = await criarUsuario(barbeariaId, { nome, email, senha, papel });
          if (!r.ok) return setErro(r.erro);
          setCriado(`Acesse: ${location.origin}/entrar\nE-mail: ${email.trim().toLowerCase()}\nSenha provisória: ${senha}`);
        });
      }}
    >
      <div className={s.campo}>
        <span className={s.rotulo}>Papel</span>
        <div className={s.linha}>
          {(['dono', 'barbeiro'] as const).map((p) => (
            <button key={p} type="button" className={s.chip} aria-pressed={papel === p} onClick={() => setPapel(p)}>
              {p === 'dono' ? 'Dono' : 'Barbeiro'}
            </button>
          ))}
        </div>
        <span className={s.dica}>O dono gerencia equipe e horários; o barbeiro vê agenda, serviços e clientes.</span>
      </div>
      <div className={s.campo}>
        <label htmlFor="u-nome">Nome</label>
        <input id="u-nome" className={s.entrada} value={nome} onChange={(e) => setNome(e.target.value)} required autoCapitalize="words" />
      </div>
      <div className={s.campo}>
        <label htmlFor="u-email">E-mail</label>
        <input id="u-email" type="email" className={s.entrada} value={email} onChange={(e) => setEmail(e.target.value)} required autoCapitalize="none" inputMode="email" />
      </div>
      <div className={s.campo}>
        <label htmlFor="u-senha">Senha provisória</label>
        <div className={s.linha} style={{ flexWrap: 'nowrap' }}>
          <input id="u-senha" className={s.entrada} value={senha} onChange={(e) => setSenha(e.target.value)} minLength={8} required style={{ fontFamily: 'ui-monospace, monospace' }} />
          <button type="button" className={s.botao} onClick={() => setSenha(senhaAleatoria())}>
            Gerar
          </button>
        </div>
      </div>
      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente}>
        {pendente ? 'Criando…' : 'Criar usuário'}
      </button>
    </form>
  );
}
