import type { Barbearia, Layout } from '@/lib/barbearia';
import { montarSite, type SiteProps } from '@/lib/site';
import { Classico } from '@/components/layouts/Classico';
import { Luxo } from '@/components/layouts/Luxo';
import { Minimalista } from '@/components/layouts/Minimalista';
import { Urbano } from '@/components/layouts/Urbano';
import { TemaRaiz } from './TemaRaiz';

const LAYOUTS: Record<Layout, (p: SiteProps) => React.ReactNode> = {
  classico: Classico,
  urbano: Urbano,
  luxo: Luxo,
  minimalista: Minimalista,
};

export function SiteBarbearia({ barbearia }: { barbearia: Barbearia }) {
  const Componente = LAYOUTS[barbearia.tema.layout] ?? Luxo;
  return (
    <TemaRaiz tema={barbearia.tema}>
      <Componente {...montarSite(barbearia)} />
    </TemaRaiz>
  );
}
