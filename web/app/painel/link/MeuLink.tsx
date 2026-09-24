'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAviso } from '@/components/interno/Comuns';
import { ICopiar, IDownload, IExterno } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';
import l from './link.module.css';

export function MeuLink({ url, nome, slug, ativo }: { url: string; nome: string; slug: string; ativo: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [cartaz, setCartaz] = useState<string | null>(null);
  const [aviso, mostrar] = useAviso();
  const [podeCompartilhar, setPodeCompartilhar] = useState(false);
  const exibicao = url.replace(/^https?:\/\//, '');

  useEffect(() => {
    setPodeCompartilhar(typeof navigator !== 'undefined' && !!navigator.share);
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(setQr);
  }, [url]);

  // Cartaz pronto para imprimir: QR + nome + link, em PNG
  useEffect(() => {
    if (!qr) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1240;
      c.height = 1754; // A5 a 150 dpi, proporção A4/A5
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#111111';
      g.textAlign = 'center';
      g.font = '700 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      g.fillText('Agende seu horário', c.width / 2, 200, 1100);
      g.font = '400 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      g.fillStyle = '#444444';
      g.fillText('Aponte a câmera do celular', c.width / 2, 280, 1100);
      g.drawImage(img, 170, 360, 900, 900);
      g.fillStyle = '#111111';
      g.font = '700 72px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      g.fillText(nome, c.width / 2, 1400, 1100);
      g.font = '500 44px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillStyle = '#444444';
      g.fillText(exibicao, c.width / 2, 1490, 1150);
      setCartaz(c.toDataURL('image/png'));
    };
    img.src = qr;
  }, [qr, nome, exibicao]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      mostrar('Link copiado!');
    } catch {
      mostrar('Não foi possível copiar. Segure o link para copiar.');
    }
  }

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Meu link</h1>
          <p className={s.sub}>Coloque na bio do Instagram, no status do WhatsApp e no balcão.</p>
        </div>
      </div>

      {!ativo && <p className={s.alerta} style={{ marginBottom: 14 }}>Sua barbearia está inativa: o site mostra “Barbearia não encontrada” até ser reativada.</p>}

      <section className={`${s.card} ${l.link}`}>
        <span className={s.rotulo}>Link público</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className={l.url}>
          {exibicao}
        </a>
        <div className={l.acoes}>
          <button className={`${s.botao} ${s.primario}`} onClick={copiar}>
            <ICopiar tamanho={18} /> Copiar link
          </button>
          {podeCompartilhar && (
            <button className={s.botao} onClick={() => navigator.share({ title: nome, text: `Agende seu horário na ${nome}`, url }).catch(() => {})}>
              Compartilhar
            </button>
          )}
          <a className={s.botao} href={url} target="_blank" rel="noopener noreferrer">
            <IExterno tamanho={18} /> Abrir site
          </a>
        </div>
      </section>

      <h2 className={s.secaoTitulo}>QR Code</h2>
      <section className={`${s.card} ${l.qrCard}`}>
        <div className={l.qr}>{qr ? <img src={qr} alt={`QR Code para ${exibicao}`} /> : <span className={s.girando} />}</div>
        <div className={l.qrTexto}>
          <p>Imprima e deixe no balcão ou no espelho: o cliente aponta a câmera e cai direto no seu site para agendar.</p>
          <div className={l.acoes}>
            {qr && (
              <a className={`${s.botao} ${s.primario}`} href={qr} download={`qrcode-${slug}.png`}>
                <IDownload tamanho={18} /> Baixar QR Code
              </a>
            )}
            {cartaz && (
              <a className={s.botao} href={cartaz} download={`cartaz-${slug}.png`}>
                <IDownload tamanho={18} /> Baixar cartaz para imprimir
              </a>
            )}
          </div>
        </div>
      </section>
      {aviso}
    </>
  );
}
