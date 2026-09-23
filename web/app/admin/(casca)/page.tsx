import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseServidor } from '@/lib/supabase';
import { IBusca, IMais } from '@/components/interno/Icones';
import { ListaBarbearias, type LinhaBarbearia } from './ListaBarbearias';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Barbearias' };

export default async function AdminInicio({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 60);
  const status = sp.status === 'ativas' || sp.status === 'inativas' ? sp.status : 'todas';
  const sb = await supabaseServidor();
  let consulta = sb.from('barbearias').select('id, slug, nome, cidade, ativo, created_at, tema->logo_url', { count: 'exact' }).order('created_at', { ascending: false }).limit(500);
  if (q) {
    const t = q.replace(/[%,()*]/g, ' ');
    consulta = consulta.or(`nome.ilike.%${t}%,slug.ilike.%${t}%,cidade.ilike.%${t}%`);
  }
  if (status !== 'todas') consulta = consulta.eq('ativo', status === 'ativas');
  const { data, count } = await consulta;

  const filtro = (st: string) => `/admin?${new URLSearchParams({ ...(q ? { q } : {}), ...(st !== 'todas' ? { status: st } : {}) })}`;

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Barbearias</h1>
          <p className={s.sub}>{count ?? 0} {count === 1 ? 'barbearia' : 'barbearias'}{q ? ` para “${q}”` : ''}</p>
        </div>
        <Link href="/admin/nova" className={`${s.botao} ${s.primario}`}>
          <IMais tamanho={18} /> Nova barbearia
        </Link>
      </div>
      <form role="search" className={s.linha} style={{ marginBottom: 12, flexWrap: 'nowrap', position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', zIndex: 1, pointerEvents: 'none' }} className={s.fraco}>
          <IBusca tamanho={18} />
        </span>
        <input name="q" type="search" defaultValue={q} placeholder="Buscar por nome, endereço ou cidade" className={s.entrada} style={{ paddingLeft: 40 }} aria-label="Buscar barbearias" />
        {status !== 'todas' && <input type="hidden" name="status" value={status} />}
      </form>
      <div className={s.chips} style={{ margin: '0 -16px 14px' }}>
        {(['todas', 'ativas', 'inativas'] as const).map((st) => (
          <Link key={st} href={filtro(st)} className={s.chip} aria-current={status === st} style={{ textTransform: 'capitalize' }}>
            {st}
          </Link>
        ))}
      </div>
      <ListaBarbearias barbearias={(data ?? []) as unknown as LinhaBarbearia[]} />
    </>
  );
}
