import type { CSSProperties } from 'react';
import type { ParFontes, Tema } from './barbearia';

/** `letra`: largura média de uma letra maiúscula do título, em em (para caber títulos grandes). */
type Par = { titulo: string; texto: string; tituloFallback: string; letra: number; familias: string[] };

export const PARES_FONTES: Record<ParFontes, Par> = {
  elegante: {
    titulo: 'Playfair Display',
    texto: 'Inter',
    tituloFallback: 'Georgia, serif',
    letra: 0.62,
    familias: ['Playfair+Display:ital,wght@0,400;0,600;0,700;1,400', 'Inter:wght@300;400;500;600'],
  },
  moderna: {
    titulo: 'Space Grotesk',
    texto: 'Inter',
    tituloFallback: 'system-ui, sans-serif',
    letra: 0.6,
    familias: ['Space+Grotesk:wght@400;500;700', 'Inter:wght@300;400;500;600'],
  },
  classica: {
    titulo: 'Cinzel',
    texto: 'Lato',
    tituloFallback: 'Georgia, serif',
    letra: 0.74,
    familias: ['Cinzel:wght@400;600;700', 'Lato:ital,wght@0,400;0,700;1,400'],
  },
  impacto: {
    titulo: 'Bebas Neue',
    texto: 'Roboto',
    tituloFallback: "Impact, 'Arial Narrow', sans-serif",
    letra: 0.42,
    familias: ['Bebas+Neue', 'Roboto:wght@400;500;700;900'],
  },
};

export function parFontes(tema: Tema): Par {
  return PARES_FONTES[tema.par_fontes] ?? PARES_FONTES.elegante;
}

export function urlGoogleFonts(tema: Tema): string {
  const familias = parFontes(tema).familias.map((f) => `family=${f}`).join('&');
  return `https://fonts.googleapis.com/css2?${familias}&display=swap`;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Só aceita #rgb / #rrggbb (o banco já valida; aqui é defesa extra contra CSS injetado). */
export function corSegura(cor: string | undefined): string | undefined {
  return cor && HEX.test(cor) ? cor : undefined;
}

function luminancia(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Entre as cores do próprio tema, escolhe a mais legível sobre `base`. */
function legivelSobre(base: string | undefined, opcoes: (string | undefined)[]): string | undefined {
  if (!base) return undefined;
  const validas = opcoes.filter((c): c is string => !!c);
  if (!validas.length) return undefined;
  const melhor = validas.reduce((a, b) => (contraste(base, b) > contraste(base, a) ? b : a));
  if (contraste(base, melhor) >= 3) return melhor;
  return luminancia(base) > 0.4 ? '#000000' : '#ffffff';
}

/** Converte o tema em variáveis CSS aplicadas na raiz do site. */
export function variaveisTema(tema: Tema): CSSProperties {
  const primaria = corSegura(tema.cor_primaria);
  const destaque = corSegura(tema.cor_destaque);
  const fundo = corSegura(tema.cor_fundo);
  const texto = corSegura(tema.cor_texto);
  const par = parFontes(tema);

  return {
    '--primaria': primaria,
    '--destaque': destaque,
    '--fundo': fundo,
    '--texto': texto,
    '--sobre-destaque': legivelSobre(destaque, [fundo, texto, primaria]),
    '--sobre-primaria': legivelSobre(primaria, [texto, fundo, destaque]),
    // primária quando ela contrasta com o fundo; senão, a cor do texto
    '--primaria-legivel': primaria && fundo && contraste(primaria, fundo) >= 3 ? primaria : texto,
    '--fonte-titulo': `'${par.titulo}', ${par.tituloFallback}`,
    '--letra-titulo': String(par.letra),
    '--fonte-texto': `'${par.texto}', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  } as CSSProperties;
}

/** O fundo é claro? (alguns layouts ajustam sombras/sobreposições) */
export function fundoClaro(tema: Tema): boolean {
  const fundo = corSegura(tema.cor_fundo);
  return fundo ? luminancia(fundo) > 0.4 : false;
}
