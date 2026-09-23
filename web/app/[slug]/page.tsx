import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { buscarBarbearia } from '@/lib/barbearia';
import { paragrafos } from '@/lib/formatar';
import { corSegura } from '@/lib/tema';
import { urlBase } from '@/lib/url';
import { SiteBarbearia } from '@/components/site/SiteBarbearia';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  if (!b) return { title: 'Barbearia não encontrada', robots: { index: false } };

  const descricao =
    b.tema.subtitulo_hero?.trim() ||
    paragrafos(b.tema.texto_sobre ?? '')[0]?.slice(0, 160) ||
    [b.nome, b.cidade].filter(Boolean).join(' · ');
  const imagem = b.tema.logo_url || b.tema.foto_capa_url;

  return {
    metadataBase: await urlBase(),
    title: b.nome,
    description: descricao,
    alternates: { canonical: `/${b.slug}` },
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      url: `/${b.slug}`,
      siteName: b.nome,
      title: b.nome,
      description: descricao,
      images: imagem ? [{ url: imagem, alt: b.nome }] : undefined,
    },
    twitter: {
      card: 'summary',
      title: b.nome,
      description: descricao,
      images: imagem ? [imagem] : undefined,
    },
    icons: b.tema.logo_url ? { icon: b.tema.logo_url, apple: b.tema.logo_url } : undefined,
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  return { themeColor: corSegura(b?.tema.cor_fundo) };
}

export default async function PaginaBarbearia({ params }: Props) {
  const { slug } = await params;
  const barbearia = await buscarBarbearia(slug);
  if (!barbearia) notFound();
  return <SiteBarbearia barbearia={barbearia} />;
}
