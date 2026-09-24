import type { Metadata } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { urlBase } from '@/lib/url';
import { MeuLink } from './MeuLink';

export const metadata: Metadata = { title: 'Meu link' };

export default async function PaginaLink() {
  const { barbearia } = await exigirPainel();
  const url = new URL(`/${barbearia.slug}`, await urlBase()).toString();
  return <MeuLink url={url} nome={barbearia.nome} slug={barbearia.slug} ativo={barbearia.ativo} />;
}
