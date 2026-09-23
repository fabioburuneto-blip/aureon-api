'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { mascaraTelefone } from '@/lib/agendamento';
import { slugificar } from '@/lib/slug';
import { criarBarbearia, salvarDadosBarbearia, verificarSlug, type DadosBarbearia } from '../acoes';
import { useAviso } from '@/components/interno/Comuns';
import s from '@/components/interno/ui.module.css';

export function FormBarbearia({ id, inicial, origem }: { id?: string; inicial?: DadosBarbearia; origem: string }) {
  const [d, setD] = useState<DadosBarbearia>(inicial ?? { nome: '', slug: '', whatsapp: '', endereco: '', cidade: '', instagram: '' });
  const [slugManual, setSlugManual] = useState(!!inicial);
  const [slugStatus, setSlugStatus] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [aviso, mostrar] = useAviso();
  const seq = useRef(0);

  const mudar = (campo: keyof DadosBarbearia, v: string) => setD((x) => ({ ...x, [campo]: v }));

  // slug automático a partir do nome até o usuário editar o slug
  useEffect(() => {
    if (!slugManual) setD((x) => ({ ...x, slug: slugificar(x.nome) }));
  }, [d.nome, slugManual]);

  // verificação de disponibilidade (com atraso para não chamar a cada tecla)
  useEffect(() => {
    if (!d.slug) return setSlugStatus(null);
    if (inicial && d.slug === inicial.slug) return setSlugStatus(null);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await verificarSlug(d.slug, id);
      if (n === seq.current) setSlugStatus(r);
    }, 350);
    return () => clearTimeout(t);
  }, [d.slug, id, inicial]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = id ? await salvarDadosBarbearia(id, d) : await criarBarbearia(d);
      if (!r.ok) return setErro(r.erro);
      mostrar('Dados salvos');
    });
  }

  return (
    <form className={s.form} onSubmit={enviar}>
      <div className={s.campo}>
        <label htmlFor="b-nome">Nome da barbearia</label>
        <input id="b-nome" className={s.entrada} value={d.nome} onChange={(e) => mudar('nome', e.target.value)} maxLength={80} required autoFocus={!id} />
      </div>
      <div className={s.campo}>
        <label htmlFor="b-slug">Endereço do site</label>
        <div style={{ position: 'relative' }}>
          <span className={s.fraco} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 15 }}>
            {origem.replace(/^https?:\/\//, '')}/
          </span>
          <input
            id="b-slug"
            className={s.entrada}
            style={{ paddingLeft: `${origem.replace(/^https?:\/\//, '').length * 7.6 + 22}px` }}
            value={d.slug}
            onChange={(e) => {
              setSlugManual(true);
              mudar('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'));
            }}
            maxLength={60}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={slugStatus ? !slugStatus.ok : undefined}
            aria-describedby="b-slug-status"
            required
          />
        </div>
        <span id="b-slug-status" className={s.dica} style={slugStatus ? { color: slugStatus.ok ? 'var(--ok)' : 'var(--erro)' } : undefined}>
          {slugStatus ? slugStatus.mensagem : 'Minúsculas, números e hífens. É o link que vai na bio do Instagram.'}
        </span>
      </div>
      <div className={`${s.grade} ${s.grade2}`}>
        <div className={s.campo}>
          <label htmlFor="b-wa">WhatsApp</label>
          <input id="b-wa" type="tel" inputMode="numeric" className={s.entrada} placeholder="(11) 91234-5678" value={mascaraTelefone(d.whatsapp)} onChange={(e) => mudar('whatsapp', e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className={s.campo}>
          <label htmlFor="b-ig">Instagram</label>
          <input id="b-ig" className={s.entrada} placeholder="@barbearia" value={d.instagram} onChange={(e) => mudar('instagram', e.target.value)} autoCapitalize="none" />
        </div>
      </div>
      <div className={`${s.grade} ${s.grade2}`}>
        <div className={s.campo}>
          <label htmlFor="b-end">Endereço</label>
          <input id="b-end" className={s.entrada} placeholder="Rua, número — bairro" value={d.endereco} onChange={(e) => mudar('endereco', e.target.value)} />
        </div>
        <div className={s.campo}>
          <label htmlFor="b-cid">Cidade</label>
          <input id="b-cid" className={s.entrada} placeholder="São Paulo - SP" value={d.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
        </div>
      </div>
      {erro && <p className={s.alerta}>{erro}</p>}
      <button className={`${s.botao} ${s.primario}`} disabled={pendente || (slugStatus !== null && !slugStatus.ok)} style={{ justifySelf: 'start' }}>
        {pendente ? 'Salvando…' : id ? 'Salvar dados' : 'Criar barbearia'}
      </button>
      {aviso}
    </form>
  );
}
