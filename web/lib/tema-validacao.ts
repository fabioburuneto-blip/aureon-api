import type { Layout, ParFontes, Tema } from './barbearia';

const LAYOUTS: Layout[] = ['classico', 'urbano', 'luxo', 'minimalista'];
const PARES: ParFontes[] = ['elegante', 'moderna', 'classica', 'impacto'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Valida e normaliza o tema antes de salvar (o banco também valida a estrutura).
 * Imagens só podem vir do Storage da própria barbearia, de caminhos locais (/demo/…) ou vazias.
 */
export function validarTema(t: Tema, barbeariaId: string): { ok: true; tema: Tema } | { ok: false; erro: string } {
  if (!t || typeof t !== 'object') return { ok: false, erro: 'Tema inválido.' };
  if (!LAYOUTS.includes(t.layout)) return { ok: false, erro: 'Layout inválido.' };
  if (!PARES.includes(t.par_fontes)) return { ok: false, erro: 'Par de fontes inválido.' };
  for (const c of ['cor_primaria', 'cor_destaque', 'cor_fundo', 'cor_texto'] as const) {
    if (!HEX.test(t[c] ?? '')) return { ok: false, erro: `Cor inválida em ${c.replace('cor_', '')}.` };
  }
  const storage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/barbearias/${barbeariaId}/`;
  const imagemOk = (u: unknown) => typeof u === 'string' && u.length < 500 && (u === '' || u.startsWith(storage) || /^\/[a-z0-9/_.-]+$/i.test(u));
  if (!imagemOk(t.logo_url) || !imagemOk(t.foto_capa_url)) return { ok: false, erro: 'Imagem inválida.' };
  if (!Array.isArray(t.galeria) || t.galeria.length > 24 || !t.galeria.every((u) => u !== '' && imagemOk(u))) {
    return { ok: false, erro: 'Galeria inválida (máximo de 24 fotos).' };
  }
  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    ok: true,
    tema: {
      layout: t.layout,
      par_fontes: t.par_fontes,
      cor_primaria: t.cor_primaria,
      cor_destaque: t.cor_destaque,
      cor_fundo: t.cor_fundo,
      cor_texto: t.cor_texto,
      logo_url: t.logo_url,
      foto_capa_url: t.foto_capa_url,
      galeria: t.galeria,
      titulo_hero: texto(t.titulo_hero, 90).trim(),
      subtitulo_hero: texto(t.subtitulo_hero, 200).trim(),
      texto_sobre: texto(t.texto_sobre, 2000).trim(),
    },
  };
}
