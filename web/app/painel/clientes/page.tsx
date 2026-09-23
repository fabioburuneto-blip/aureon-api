import type { Metadata } from 'next';
import { exigirPainel } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import { dataCurta, diaCurto, diaSP, hora } from '@/lib/datas';
import { linkWhatsapp, whatsappFormatado } from '@/lib/formatar';
import { IBusca } from '@/components/interno/Icones';
import { IconeWhatsapp } from '@/components/site/Icones';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Clientes' };

type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  visitas: number;
  ultima_visita: string | null;
  proximo_agendamento: string | null;
  faltas: number;
};

export default async function PaginaClientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { barbearia } = await exigirPainel();
  const q = ((await searchParams).q ?? '').trim().slice(0, 60);
  const sb = await supabaseServidor();

  let consulta = sb
    .from('clientes_resumo')
    .select('id, nome, telefone, visitas, ultima_visita, proximo_agendamento, faltas', { count: 'exact' })
    .eq('barbearia_id', barbearia.id)
    .order('ultima_visita', { ascending: false, nullsFirst: false })
    .order('nome')
    .limit(300);
  if (q) {
    const digitos = q.replace(/\D/g, '');
    const termo = q.replace(/[%,()*]/g, ' ');
    consulta = digitos.length >= 3 ? consulta.or(`nome.ilike.%${termo}%,telefone.like.%${digitos}%`) : consulta.ilike('nome', `%${termo}%`);
  }
  const { data, count } = await consulta;
  const clientes = (data ?? []) as Cliente[];

  return (
    <>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Clientes</h1>
          <p className={s.sub}>{count ?? 0} {count === 1 ? 'cliente' : 'clientes'}{q ? ` encontrados para “${q}”` : ' cadastrados'}. Visitas contam os atendimentos concluídos.</p>
        </div>
      </div>

      <form role="search" style={{ position: 'relative', marginBottom: 14 }}>
        <IBusca className={s.fraco} tamanho={18} />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por nome ou telefone"
          className={s.entrada}
          style={{ paddingLeft: 40, position: 'relative' }}
          aria-label="Buscar clientes"
        />
        <style>{`form[role=search] svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);z-index:1;pointer-events:none}`}</style>
      </form>

      {clientes.length === 0 ? (
        <div className={s.vazio}>{q ? 'Nenhum cliente encontrado.' : 'Os clientes aparecem aqui conforme forem agendando.'}</div>
      ) : (
        <ul className={s.lista}>
          {clientes.map((c) => {
            const wa = linkWhatsapp(c.telefone, `Olá, ${c.nome.split(' ')[0]}! Aqui é da ${barbearia.nome}.`);
            return (
              <li key={c.id} className={s.item}>
                <div className={s.itemCorpo}>
                  <div className={s.itemTitulo}>{c.nome}</div>
                  <div className={s.itemSub}>{whatsappFormatado(c.telefone)}</div>
                  <div className={`${s.pequeno} ${s.fraco}`} style={{ marginTop: 2 }}>
                    <strong className={s.num} style={{ color: 'var(--texto)' }}>
                      {c.visitas}
                    </strong>{' '}
                    {Number(c.visitas) === 1 ? 'visita' : 'visitas'}
                    {c.ultima_visita && ` · última em ${dataCurta(c.ultima_visita)}`}
                    {Number(c.faltas) > 0 && <span style={{ color: 'var(--aviso)' }}> · {c.faltas} falta{Number(c.faltas) > 1 ? 's' : ''}</span>}
                    {c.proximo_agendamento && (
                      <span style={{ color: 'var(--info)' }}>
                        {' '}
                        · próximo {diaCurto(diaSP(c.proximo_agendamento))} {hora(c.proximo_agendamento)}
                      </span>
                    )}
                  </div>
                </div>
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={`${s.botao} ${s.fantasma} ${s.icone}`} aria-label={`WhatsApp de ${c.nome}`}>
                    <IconeWhatsapp tamanho={20} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
