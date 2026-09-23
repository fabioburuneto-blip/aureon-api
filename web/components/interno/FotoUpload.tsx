'use client';

import { useRef, useState } from 'react';
import { enviarImagem } from '@/lib/supabase-navegador';
import { IImagem, ILixo } from './Icones';
import s from './ui.module.css';
import f from './foto.module.css';

/** Seleciona uma imagem, envia ao Storage da barbearia e devolve a URL pública. */
export function FotoUpload({
  barbeariaId,
  pasta,
  url,
  onMudar,
  formato = 'circulo',
  rotulo = 'Foto',
  max,
}: {
  barbeariaId: string;
  pasta: string;
  url: string | null;
  onMudar: (url: string | null) => void;
  formato?: 'circulo' | 'quadrado' | 'largo';
  rotulo?: string;
  max?: number;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(arq: File | undefined) {
    if (!arq) return;
    setErro(null);
    setEnviando(true);
    try {
      onMudar(await enviarImagem(barbeariaId, pasta, arq, max));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <div className={f.caixa}>
      <button
        type="button"
        className={`${f.previa} ${f[formato]}`}
        onClick={() => entrada.current?.click()}
        aria-label={url ? `Trocar ${rotulo.toLowerCase()}` : `Escolher ${rotulo.toLowerCase()}`}
        disabled={enviando}
      >
        {url ? <img src={url} alt="" /> : <IImagem tamanho={26} />}
        {enviando && (
          <span className={f.carregando}>
            <span className={s.girando} />
          </span>
        )}
      </button>
      <div className={f.acoes}>
        <span className={s.rotulo}>{rotulo}</span>
        <div className={s.linha}>
          <button type="button" className={`${s.botao} ${s.pequenoBotao}`} onClick={() => entrada.current?.click()} disabled={enviando}>
            {url ? 'Trocar' : 'Escolher imagem'}
          </button>
          {url && (
            <button type="button" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`} onClick={() => onMudar(null)} disabled={enviando}>
              <ILixo tamanho={16} /> Remover
            </button>
          )}
        </div>
        {erro && <span className={s.erro}>{erro}</span>}
      </div>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => escolher(e.target.files?.[0])} />
    </div>
  );
}
