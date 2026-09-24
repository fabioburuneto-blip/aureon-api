'use client';

import { useActionState } from 'react';
import { entrar, type EstadoEntrar } from './acoes';
import { ILoja } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';
import e from './entrar.module.css';

export function FormEntrar({ proximo, erroInicial }: { proximo: string; erroInicial: string | null }) {
  const [estado, acao, enviando] = useActionState<EstadoEntrar, FormData>(entrar, { erro: erroInicial, email: '' });

  return (
    <div className={`${s.raiz} ${e.pagina}`}>
      <style>{'html,body{background:#0b0d10}'}</style>
      <main className={e.caixa}>
        <span className={e.logo}>
          <ILoja tamanho={26} />
        </span>
        <h1 className={s.titulo}>Entrar</h1>
        <p className={s.sub}>Acesse o painel da sua barbearia.</p>

        <form action={acao} className={`${s.form} ${e.form}`}>
          <input type="hidden" name="proximo" value={proximo} />
          <div className={s.campo}>
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              className={s.entrada}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              required
              defaultValue={estado.email}
              key={estado.email}
            />
          </div>
          <div className={s.campo}>
            <label htmlFor="senha">Senha</label>
            <input id="senha" name="senha" type="password" className={s.entrada} autoComplete="current-password" required />
          </div>
          {estado.erro && (
            <p className={s.alerta} role="alert">
              {estado.erro}
            </p>
          )}
          <button className={`${s.botao} ${s.primario} ${s.largo}`} disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>
    </div>
  );
}
