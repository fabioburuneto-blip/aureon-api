import type { Metadata } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { FormSenha } from './FormSenha';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Minha conta' };

export default async function Conta() {
  const { sessao } = await exigirPainel();
  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Minha conta</h1>
          <p className={s.sub}>
            {sessao.nome} · {sessao.email}
          </p>
        </div>
      </div>
      <div className={s.card} style={{ maxWidth: 480 }}>
        <FormSenha />
      </div>
    </>
  );
}
