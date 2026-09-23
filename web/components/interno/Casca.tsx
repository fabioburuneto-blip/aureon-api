'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IEquipe, ILoja, ISair } from './Icones';
import s from './ui.module.css';

export type ItemNav = { href: string; rotulo: string; icone: React.ReactNode; exato?: boolean };

export function Casca({
  marca,
  usuario,
  itens,
  sair,
  contaHref,
  children,
}: {
  marca: { nome: string; logo?: string; href: string };
  usuario: string;
  itens: ItemNav[];
  sair: () => Promise<void>;
  contaHref?: string;
  children: React.ReactNode;
}) {
  const caminho = usePathname();
  const ativo = (i: ItemNav) => (i.exato ? caminho === i.href : caminho === i.href || caminho.startsWith(`${i.href}/`));

  const links = itens.map((i) => (
    <Link key={i.href} href={i.href} className={s.navItem} aria-current={ativo(i) ? 'page' : undefined} prefetch>
      {i.icone}
      <span>{i.rotulo}</span>
    </Link>
  ));

  return (
    <div className={`${s.raiz} ${s.casca}`}>
      <header className={s.topo}>
        <Link href={marca.href} className={s.marca}>
          {marca.logo ? (
            <img src={marca.logo} alt="" />
          ) : (
            <span className={s.marcaIcone}>
              <ILoja tamanho={18} />
            </span>
          )}
          <span>{marca.nome}</span>
        </Link>
        <div className={s.topoDireita}>
          <span className={s.usuario}>{usuario}</span>
          {contaHref && (
            <Link href={contaHref} className={`${s.botao} ${s.fantasma} ${s.icone}`} aria-label="Minha conta" title="Minha conta">
              <IEquipe />
            </Link>
          )}
          <form action={sair}>
            <button className={`${s.botao} ${s.fantasma} ${s.icone}`} aria-label="Sair" title="Sair">
              <ISair />
            </button>
          </form>
        </div>
      </header>
      <nav className={s.lateral} aria-label="Menu">
        {links}
      </nav>
      <main className={s.principal}>{children}</main>
      <nav className={s.navInferior} aria-label="Menu">
        {links}
      </nav>
    </div>
  );
}
