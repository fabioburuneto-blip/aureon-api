'use client';

import { useState, useTransition } from 'react';
import { alterarSenha } from './acoes';
import s from '@/components/interno/ui.module.css';

export function FormSenha() {
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await alterarSenha(nova, conf);
          setMsg(r.ok ? { ok: true, texto: 'Senha alterada com sucesso.' } : { ok: false, texto: r.erro });
          if (r.ok) {
            setNova('');
            setConf('');
          }
        });
      }}
    >
      <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Alterar senha</h2>
      <div className={s.campo}>
        <label htmlFor="nova">Nova senha</label>
        <input id="nova" type="password" className={s.entrada} autoComplete="new-password" minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} required />
      </div>
      <div className={s.campo}>
        <label htmlFor="conf">Confirme a nova senha</label>
        <input id="conf" type="password" className={s.entrada} autoComplete="new-password" minLength={8} value={conf} onChange={(e) => setConf(e.target.value)} required />
      </div>
      {msg && <p className={`${s.alerta} ${msg.ok ? s.alertaOk : ''}`}>{msg.texto}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente}>
        {pendente ? 'Salvando…' : 'Alterar senha'}
      </button>
    </form>
  );
}
