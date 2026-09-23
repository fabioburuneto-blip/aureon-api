import { preconnect } from 'react-dom';
import type { Tema } from '@/lib/barbearia';
import { corSegura, urlGoogleFonts, variaveisTema } from '@/lib/tema';

/** Aplica o tema da barbearia: fontes do Google, variáveis CSS e cor de fundo da página. */
export function TemaRaiz({ tema, children }: { tema: Tema; children: React.ReactNode }) {
  preconnect('https://fonts.googleapis.com');
  preconnect('https://fonts.gstatic.com', { crossOrigin: 'anonymous' });
  const fundo = corSegura(tema.cor_fundo);

  return (
    <>
      <link rel="stylesheet" href={urlGoogleFonts(tema)} precedence="fontes" />
      {/* evita "flash" de outra cor no overscroll do celular */}
      {fundo && <style>{`html,body{background:${fundo}}`}</style>}
      <div className="tema-raiz" style={variaveisTema(tema)}>
        {children}
      </div>
    </>
  );
}
