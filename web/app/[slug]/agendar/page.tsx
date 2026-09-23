import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buscarBarbearia } from '@/lib/barbearia';
import { linkWhatsapp } from '@/lib/formatar';
import { TemaRaiz } from '@/components/site/TemaRaiz';
import { IconeWhatsapp } from '@/components/site/Icones';
import s from './agendar.module.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  return { title: b ? `Agendar · ${b.nome}` : 'Barbearia não encontrada', robots: { index: false } };
}

// Provisório: o fluxo de agendamento online (horarios_livres / criar_agendamento_publico)
// entra na próxima etapa. Por enquanto oferece o WhatsApp.
export default async function Agendar({ params }: Props) {
  const { slug } = await params;
  const b = await buscarBarbearia(slug);
  if (!b) notFound();
  const wa = linkWhatsapp(b.whatsapp, `Olá, ${b.nome}! Gostaria de agendar um horário.`);

  return (
    <TemaRaiz tema={b.tema}>
      <main className={s.pagina}>
        {b.tema.logo_url && <img className={s.logo} src={b.tema.logo_url} alt={b.nome} width={88} height={88} />}
        <h1 className={s.titulo}>Agendamento online em breve</h1>
        <p className={s.texto}>Enquanto isso, fale com a {b.nome} pelo WhatsApp para marcar seu horário.</p>
        {wa && (
          <a className={s.botao} href={wa} target="_blank" rel="noopener noreferrer">
            <IconeWhatsapp /> Agendar pelo WhatsApp
          </a>
        )}
        <Link className={s.voltar} href={`/${b.slug}`}>
          Voltar para o site
        </Link>
      </main>
    </TemaRaiz>
  );
}
