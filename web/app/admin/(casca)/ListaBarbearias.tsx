'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { alternarBarbearia } from '../acoes';
import { Chave, useAviso } from '@/components/interno/Comuns';
import { IExterno, ILoja, ILapis } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';

export type LinhaBarbearia = { id: string; slug: string; nome: string; cidade: string | null; ativo: boolean; logo_url: string | null };

export function ListaBarbearias({ barbearias }: { barbearias: LinhaBarbearia[] }) {
  const [pendente, iniciar] = useTransition();
  const [aviso, mostrar] = useAviso();
  if (!barbearias.length) return <div className={s.vazio}>Nenhuma barbearia encontrada.</div>;
  return (
    <>
      <ul className={s.lista}>
        {barbearias.map((b) => (
          <li key={b.id} className={`${s.item} ${b.ativo ? '' : s.itemInativo}`}>
            <span className={s.avatar} style={{ borderRadius: 10 }}>
              {b.logo_url ? <img src={b.logo_url} alt="" /> : <ILoja tamanho={20} />}
            </span>
            <Link href={`/admin/barbearias/${b.id}`} className={s.itemCorpo} style={{ textDecoration: 'none' }}>
              <div className={s.itemTitulo}>{b.nome}</div>
              <div className={s.itemSub}>
                /{b.slug}
                {b.cidade ? ` · ${b.cidade}` : ''}
                {b.ativo ? '' : ' · inativa'}
              </div>
            </Link>
            <Chave
              ligada={b.ativo}
              rotulo={`${b.ativo ? 'Desativar' : 'Ativar'} ${b.nome}`}
              desabilitada={pendente}
              onMudar={(v) =>
                iniciar(async () => {
                  const r = await alternarBarbearia(b.id, v);
                  mostrar(r.ok ? (v ? `${b.nome} ativada` : `${b.nome} desativada`) : r.erro);
                })
              }
            />
            <a href={`/${b.slug}`} target="_blank" rel="noopener noreferrer" className={`${s.botao} ${s.fantasma} ${s.icone}`} aria-label={`Abrir site de ${b.nome}`}>
              <IExterno tamanho={18} />
            </a>
            <Link href={`/admin/barbearias/${b.id}`} className={`${s.botao} ${s.fantasma} ${s.icone}`} aria-label={`Editar ${b.nome}`}>
              <ILapis tamanho={18} />
            </Link>
          </li>
        ))}
      </ul>
      {aviso}
    </>
  );
}
