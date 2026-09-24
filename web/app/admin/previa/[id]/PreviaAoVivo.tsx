'use client';

import { useEffect, useState } from 'react';
import type { Barbearia, Tema } from '@/lib/barbearia';
import { SiteBarbearia } from '@/components/site/SiteBarbearia';

/** Renderiza o site com o tema recebido do editor (postMessage), sem salvar nada. */
export function PreviaAoVivo({ inicial }: { inicial: Barbearia }) {
  const [b, setB] = useState(inicial);

  useEffect(() => {
    const receber = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.tipo !== 'tema') return;
      setB((x) => ({ ...x, tema: e.data.tema as Tema }));
    };
    window.addEventListener('message', receber);
    window.parent?.postMessage({ tipo: 'previa-pronta' }, location.origin);

    // na prévia, links não navegam (evita sair do site dentro do iframe)
    const bloquear = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (a && !a.getAttribute('href')?.startsWith('#')) e.preventDefault();
    };
    document.addEventListener('click', bloquear, true);
    return () => {
      window.removeEventListener('message', receber);
      document.removeEventListener('click', bloquear, true);
    };
  }, []);

  return <SiteBarbearia barbearia={b} />;
}
