import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin, supabaseServidor } from '@/lib/supabase';
import { urlBase } from '@/lib/url';
import { FormBarbearia } from '../../FormBarbearia';
import { Usuarios, type UsuarioLinha } from './Usuarios';
import { IEsquerda, IExterno, IPaleta } from '@/components/interno/Icones';
import s from '@/components/interno/ui.module.css';

export const metadata: Metadata = { title: 'Barbearia' };

export default async function PaginaBarbearia({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string }>;
}) {
  const { id } = await params;
  const { criada } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServidor();
  const [{ data: b }, { data: perfis }] = await Promise.all([
    sb.from('barbearias').select('id, slug, nome, whatsapp, endereco, cidade, instagram, ativo, tema').eq('id', id).maybeSingle(),
    sb.from('perfis').select('id, nome, papel').eq('barbearia_id', id).order('papel').order('nome'),
  ]);
  if (!b) notFound();

  // e-mails ficam no Auth: só a service_role consegue ler
  let usuarios: UsuarioLinha[] = (perfis ?? []).map((p) => ({ ...p, email: null }));
  try {
    const admin = supabaseAdmin();
    usuarios = await Promise.all(
      (perfis ?? []).map(async (p) => ({ ...p, email: (await admin.auth.admin.getUserById(p.id)).data.user?.email ?? null })),
    );
  } catch {
    /* sem service_role configurada: mostra só nomes */
  }
  const origem = (await urlBase()).origin;

  return (
    <>
      <Link href="/admin" className={`${s.botao} ${s.fantasma} ${s.pequenoBotao}`} style={{ marginLeft: -12 }}>
        <IEsquerda tamanho={18} /> Barbearias
      </Link>
      <div className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>{b.nome}</h1>
          <p className={s.sub}>
            /{b.slug} · {b.ativo ? 'ativa' : 'inativa'}
          </p>
        </div>
        <div className={s.linha}>
          <a href={`/${b.slug}`} target="_blank" rel="noopener noreferrer" className={s.botao}>
            <IExterno tamanho={18} /> Ver site
          </a>
          <Link href={`/admin/barbearias/${b.id}/tema`} className={`${s.botao} ${s.primario}`}>
            <IPaleta tamanho={18} /> Editar tema
          </Link>
        </div>
      </div>

      {criada === '1' && (
        <p className={`${s.alerta} ${s.alertaOk}`} style={{ marginBottom: 16 }}>
          Barbearia criada! Próximos passos: <strong>editar o tema</strong> e <strong>criar o usuário do dono</strong> (abaixo). O dono cadastra serviços e equipe pelo painel.
        </p>
      )}

      <h2 className={s.secaoTitulo} style={{ marginTop: 8 }}>
        Dados
      </h2>
      <div className={s.card} style={{ maxWidth: 720 }}>
        <FormBarbearia
          id={b.id}
          origem={origem}
          inicial={{
            nome: b.nome,
            slug: b.slug,
            whatsapp: b.whatsapp ?? '',
            endereco: b.endereco ?? '',
            cidade: b.cidade ?? '',
            instagram: b.instagram ?? '',
          }}
        />
      </div>

      <h2 className={s.secaoTitulo}>Usuários</h2>
      <Usuarios barbeariaId={b.id} usuarios={usuarios} />
    </>
  );
}
