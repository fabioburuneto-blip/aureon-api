import type { Metadata, Viewport } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';
import { Casca, type ItemNav } from '@/components/interno/Casca';
import { IAgenda, IClientes, IEquipe, ILink, ITesoura } from '@/components/interno/Icones';

export const metadata: Metadata = { title: { template: '%s · Painel', default: 'Painel' }, robots: { index: false } };
export const viewport: Viewport = { themeColor: '#0b0d10' };

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { sessao, barbearia } = await exigirPainel();
  const dono = sessao.papel === 'dono';

  const itens: ItemNav[] = [
    { href: '/painel', rotulo: 'Agenda', icone: <IAgenda />, exato: true },
    { href: '/painel/servicos', rotulo: 'Serviços', icone: <ITesoura /> },
    ...(dono ? [{ href: '/painel/profissionais', rotulo: 'Equipe', icone: <IEquipe /> }] : []),
    { href: '/painel/clientes', rotulo: 'Clientes', icone: <IClientes /> },
    { href: '/painel/link', rotulo: 'Meu link', icone: <ILink /> },
  ];

  return (
    <>
      <style>{'html,body{background:#0b0d10}'}</style>
      <Casca
        marca={{ nome: barbearia.nome, logo: barbearia.logo, href: '/painel' }}
        usuario={`${sessao.nome} · ${dono ? 'Dono' : 'Barbeiro'}`}
        itens={itens}
        sair={sair}
        contaHref="/painel/conta"
      >
        {children}
      </Casca>
    </>
  );
}
