'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IFechar } from './Icones';
import s from './ui.module.css';

/** Modal acessível (<dialog>): bottom sheet no celular, centralizado no desktop. */
export function Folha({
  aberta,
  titulo,
  onFechar,
  children,
}: {
  aberta: boolean;
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);

  return (
    <dialog
      ref={ref}
      className={s.folha}
      onClose={onFechar}
      onClick={(e) => {
        if (e.target === ref.current) onFechar(); // clique no fundo fecha
      }}
      aria-label={titulo}
    >
      {aberta && (
        <>
          <div className={s.folhaTopo}>
            <h2>{titulo}</h2>
            <button type="button" className={`${s.botao} ${s.fantasma} ${s.icone}`} onClick={onFechar} aria-label="Fechar">
              <IFechar />
            </button>
          </div>
          <div className={s.folhaCorpo}>{children}</div>
        </>
      )}
    </dialog>
  );
}

/** Aviso flutuante curto ("Salvo!", "Link copiado"). */
export function useAviso(): [React.ReactNode, (texto: string) => void] {
  const [texto, setTexto] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mostrar = useCallback((t: string) => {
    setTexto(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTexto(null), 2400);
  }, []);
  const no = texto ? (
    <div className={s.aviso} role="status">
      {texto}
    </div>
  ) : null;
  return [no, mostrar];
}

export function Chave({
  ligada,
  onMudar,
  rotulo,
  desabilitada,
}: {
  ligada: boolean;
  onMudar: (v: boolean) => void;
  rotulo: string;
  desabilitada?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      title={rotulo}
      className={s.chave}
      disabled={desabilitada}
      onClick={() => onMudar(!ligada)}
    />
  );
}

export function Carregando() {
  return <span className={s.girando} aria-hidden />;
}
