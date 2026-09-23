import type { SiteProps } from '@/lib/site';
import { duracao, iniciais, preco } from '@/lib/formatar';
import { IconeInstagram, IconeLocal, IconeRelogio, IconeSeta, IconeWhatsapp } from '@/components/site/Icones';
import s from './urbano.module.css';

export function Urbano(p: SiteProps) {
  const { b } = p;
  const { tema } = b;
  const faixa = b.servicos.map((sv) => sv.nome);
  const maiorPalavra = Math.max(...p.titulo.split(/\s+/).map((w) => w.length), 4);
  let n = 0;
  const numero = () => String(++n).padStart(2, '0');

  return (
    <div className={s.site}>
      {/* 1. Hero */}
      <header className={s.hero}>
        <div className={s.topo}>
          {tema.logo_url && <img className={s.logo} src={tema.logo_url} alt="" width={48} height={48} />}
          <span className={s.marca}>{b.nome}</span>
        </div>

        <div className={s.heroGrade}>
          <h1 className={s.titulo} style={{ '--letras': maiorPalavra } as React.CSSProperties}>
            {p.titulo}
          </h1>
          {tema.foto_capa_url && (
            <div className={s.capa}>
              <img src={tema.foto_capa_url} alt="" fetchPriority="high" decoding="async" />
            </div>
          )}
          <div className={s.heroRodape}>
            {p.subtitulo && <p className={s.subtitulo}>{p.subtitulo}</p>}
            <a className={s.botao} href={p.agendarHref}>
              Agendar horário <IconeSeta tamanho={22} />
            </a>
          </div>
        </div>
      </header>

      {faixa.length > 0 && (
        <div className={s.faixa} aria-hidden>
          <div className={s.faixaTrilho}>
            {[0, 1].map((k) => (
              <span key={k}>
                {faixa.map((nome, i) => (
                  <span key={i}>
                    {nome} <b>✱</b>{' '}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}

      <main>
        {/* 2. Serviços */}
        <section className={s.secao} id="servicos" aria-labelledby="t-servicos">
          <Cabecalho id="t-servicos" numero={numero()} titulo="Serviços" />
          <ul className={s.servicos}>
            {b.servicos.map((sv) => (
              <li key={sv.id} className={s.servico}>
                <div className={s.servicoTopo}>
                  <h3 className={s.servicoNome}>{sv.nome}</h3>
                  <span className={s.servicoPreco}>{preco(sv.preco)}</span>
                </div>
                <p className={s.servicoInfo}>
                  <span className={s.etiqueta}>{duracao(sv.duracao_min)}</span>
                  {sv.descricao && <span>{sv.descricao}</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3. Equipe */}
        {p.mostrarEquipe && (
          <section className={s.secao} id="equipe" aria-labelledby="t-equipe">
            <Cabecalho id="t-equipe" numero={numero()} titulo="Equipe" />
            <ul className={s.equipe}>
              {b.profissionais.map((pr) => (
                <li key={pr.id} className={s.membro}>
                  {pr.foto_url ? (
                    <img src={pr.foto_url} alt={pr.nome} loading="lazy" decoding="async" />
                  ) : (
                    <span className={s.iniciais}>{iniciais(pr.nome)}</span>
                  )}
                  <p className={s.membroNome}>{pr.nome}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4. Sobre */}
        {p.sobre.length > 0 && (
          <section className={`${s.secao} ${s.secaoSobre}`} id="sobre" aria-labelledby="t-sobre">
            <Cabecalho id="t-sobre" numero={numero()} titulo="Sobre" />
            <div className={s.sobre}>
              {p.sobre.map((par, i) => (
                <p key={i}>{par}</p>
              ))}
            </div>
          </section>
        )}

        {/* 5. Galeria */}
        {p.mostrarGaleria && (
          <section className={s.secao} id="galeria" aria-labelledby="t-galeria">
            <Cabecalho id="t-galeria" numero={numero()} titulo="Galeria" />
            <ul className={s.galeria}>
              {tema.galeria.map((url, i) => (
                <li key={url + i}>
                  <img src={url} alt={`${b.nome} — foto ${i + 1}`} loading="lazy" decoding="async" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 6. Localização e contato */}
        <section className={s.secao} id="contato" aria-labelledby="t-contato">
          <Cabecalho id="t-contato" numero={numero()} titulo="Contato" />
          <div className={s.contato}>
            {(b.endereco || b.cidade) && (
              <div className={s.contatoEndereco}>
                <IconeLocal tamanho={28} />
                <p className={s.enderecoGrande}>{b.endereco}</p>
                {b.cidade && <p className={s.cidade}>{b.cidade}</p>}
                {p.mapaHref && (
                  <a className={s.linkSeta} href={p.mapaHref} target="_blank" rel="noopener noreferrer">
                    Abrir no mapa <IconeSeta tamanho={18} />
                  </a>
                )}
              </div>
            )}
            {p.horarios.length > 0 && (
              <div className={s.contatoHorarios}>
                <h3>
                  <IconeRelogio tamanho={20} /> Horários
                </h3>
                <dl>
                  {p.horarios.map((h) => (
                    <div key={h.dias}>
                      <dt>{h.dias}</dt>
                      <dd>{h.horario}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className={s.contatoBotoes}>
              {p.whatsapp && (
                <a className={s.botao} href={p.whatsapp.href} target="_blank" rel="noopener noreferrer">
                  <IconeWhatsapp tamanho={22} /> WhatsApp
                </a>
              )}
              {p.instagram && (
                <a className={s.botaoContorno} href={p.instagram.url} target="_blank" rel="noopener noreferrer">
                  <IconeInstagram tamanho={22} /> {p.instagram.usuario}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className={s.rodape}>
        <p className={s.rodapeNome}>{b.nome}</p>
        <p>© {new Date().getFullYear()}</p>
      </footer>

      <a className={s.ctaFixo} href={p.agendarHref}>
        Agendar horário <IconeSeta tamanho={22} />
      </a>
    </div>
  );
}

function Cabecalho({ id, numero, titulo }: { id: string; numero: string; titulo: string }) {
  return (
    <div className={s.cabecalho}>
      <span className={s.numero} aria-hidden>
        {numero}
      </span>
      <h2 id={id} className={s.tituloSecao}>
        {titulo}
      </h2>
    </div>
  );
}
