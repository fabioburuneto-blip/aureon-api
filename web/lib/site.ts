import type { Barbearia } from './barbearia';
import { horarios, instagram, linkMapa, linkWhatsapp, paragrafos, whatsappFormatado } from './formatar';

/** Tudo que os 4 layouts precisam, já derivado dos dados da barbearia. */
export type SiteProps = {
  b: Barbearia;
  titulo: string;
  subtitulo: string;
  sobre: string[];
  agendarHref: string;
  whatsapp: { href: string; texto: string } | null;
  instagram: { usuario: string; url: string } | null;
  mapaHref: string | null;
  horarios: { dias: string; horario: string }[];
  mostrarEquipe: boolean;
  mostrarGaleria: boolean;
};

export function montarSite(b: Barbearia): SiteProps {
  const wa = linkWhatsapp(b.whatsapp, `Olá, ${b.nome}! Vim pelo site e gostaria de mais informações.`);
  return {
    b,
    titulo: b.tema.titulo_hero?.trim() || b.nome,
    subtitulo: b.tema.subtitulo_hero?.trim() ?? '',
    sobre: paragrafos(b.tema.texto_sobre ?? ''),
    agendarHref: `/${b.slug}/agendar`,
    whatsapp: wa ? { href: wa, texto: whatsappFormatado(b.whatsapp) ?? '' } : null,
    instagram: instagram(b.instagram),
    mapaHref: linkMapa(b.endereco, b.cidade),
    horarios: horarios(b.horario_funcionamento),
    mostrarEquipe: b.profissionais.length > 1,
    mostrarGaleria: Array.isArray(b.tema.galeria) && b.tema.galeria.length > 0,
  };
}
