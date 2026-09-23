import type { Metadata } from 'next';
import { urlBase } from '@/lib/url';
import { FormBarbearia } from '../FormBarbearia';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Nova barbearia' };

export default async function NovaBarbearia() {
  const origem = (await urlBase()).origin;
  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Nova barbearia</h1>
          <p className={s.sub}>Depois de criar, personalize o tema e cadastre o usuário do dono.</p>
        </div>
      </div>
      <div className={s.card} style={{ maxWidth: 720 }}>
        <FormBarbearia origem={origem} />
      </div>
    </>
  );
}
