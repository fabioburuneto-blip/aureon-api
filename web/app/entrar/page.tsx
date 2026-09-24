import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { destinoDoPapel, obterSessao } from '@/lib/sessao';
import { FormEntrar } from './FormEntrar';

export const metadata: Metadata = { title: 'Entrar', robots: { index: false } };
export const viewport: Viewport = { themeColor: '#0b0d10' };

const ERROS: Record<string, string> = {
  'sem-barbearia': 'Seu usuário não está vinculado a nenhuma barbearia.',
};

export default async function Entrar({ searchParams }: { searchParams: Promise<{ proximo?: string; erro?: string }> }) {
  const { proximo, erro } = await searchParams;
  const sessao = await obterSessao();
  if (sessao && (sessao.papel === 'superadmin' || sessao.barbeariaId)) redirect(destinoDoPapel(sessao.papel));
  return <FormEntrar proximo={proximo ?? ''} erroInicial={erro ? (ERROS[erro] ?? null) : null} />;
}
