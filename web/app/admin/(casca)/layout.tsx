import { exigirSuperadmin } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';
import { Casca } from '@/components/interno/Casca';
import { ILoja, IMais } from '@/components/interno/Icones';

export default async function LayoutAdminCasca({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSuperadmin();
  return (
    <>
      <style>{'html,body{background:#0b0d10}'}</style>
      <Casca
        marca={{ nome: 'Admin', href: '/admin' }}
        usuario={`${sessao.nome} · Superadmin`}
        itens={[
          { href: '/admin', rotulo: 'Barbearias', icone: <ILoja />, exato: true },
          { href: '/admin/nova', rotulo: 'Nova', icone: <IMais /> },
        ]}
        sair={sair}
      >
        {children}
      </Casca>
    </>
  );
}
