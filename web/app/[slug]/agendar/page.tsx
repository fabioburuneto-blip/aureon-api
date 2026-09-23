import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { buscarBarbearia } from '@/lib/barbearia';
import { corSegura } from '@/lib/tema';
import { TemaRaiz } from '@/components/site/TemaRaiz';
import { Agendamento } from '@/components/agendamento/Agendamento';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  if (!b) return { title: 'Barbearia não encontrada', robots: { index: false } };
  return {
    title: `Agendar horário · ${b.nome}`,
    robots: { index: false },
    icons: b.tema.logo_url ? { icon: b.tema.logo_url, apple: b.tema.logo_url } : undefined,
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  return { themeColor: corSegura(b?.tema.cor_fundo) };
}

export default async function Agendar({ params }: Props) {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  if (!b) notFound();

  return (
    <TemaRaiz tema={b.tema}>
      <Agendamento
        b={{
          slug: b.slug,
          nome: b.nome,
          logoUrl: b.tema.logo_url,
          whatsapp: b.whatsapp,
          endereco: b.endereco,
          cidade: b.cidade,
          layout: b.tema.layout,
          servicos: b.servicos,
          profissionais: b.profissionais,
        }}
      />
    </TemaRaiz>
  );
}
