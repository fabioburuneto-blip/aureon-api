import type { SiteProps } from '@/lib/site';
import { duracao, iniciais, preco } from '@/lib/formatar';
import { IconeInstagram, IconeLocal, IconeRelogio, IconeWhatsapp } from '@/components/site/Icones';
import s from './classico.module.css';

export function Classico(p: SiteProps) {
  const { b } = p;
  const { tema } = b;

  return (
    <div className={s.site}>
      <div className={s.listras} aria-hidden />

      {/* 1. Hero */}
      <header className={s.hero}>
        <div className={s.heroTexto}>
          {tema.logo_url && <img className={s.logo} src={tema.logo_url} alt={b.nome} width={128} height={128} />}
          <p className={s.sobrelinha}>
            <Estrela /> {b.nome} <Estrela />
          </p>
          <h1 className={s.titulo}>{p.titulo}</h1>
          <Ornamento />
          {p.subtitulo && <p className={s.subtitulo}>{p.subtitulo}</p>}
          <a className={s.botao} href={p.agendarHref}>
            Agendar horário
          </a>
        </div>
        {tema.foto_capa_url && (
          <figure className={s.moldura}>
            <img src={tema.foto_capa_url} alt="" fetchPriority="high" decoding="async" />
          </figure>
        )}
      </header>

      <main>
        {/* 2. Serviços */}
        <section className={s.secao} id="servicos" aria-labelledby="t-servicos">
          <Titulo id="t-servicos">Serviços &amp; preços</Titulo>
          <div className={s.quadro}>
            <ul className={s.servicos}>
              {b.servicos.map((sv) => (
                <li key={sv.id}>
                  <div className={s.servicoLinha}>
                    <h3 className={s.servicoNome}>{sv.nome}</h3>
                    <span className={s.pontilhado} aria-hidden />
                    <span className={s.servicoPreco}>{preco(sv.preco)}</span>
                  </div>
                  <p className={s.servicoInfo}>
                    {sv.descricao && <span>{sv.descricao} · </span>}
                    <span>{duracao(sv.duracao_min)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 3. Equipe */}
        {p.mostrarEquipe && (
          <section className={s.secao} id="equipe" aria-labelledby="t-equipe">
            <Titulo id="t-equipe">Nossos barbeiros</Titulo>
            <ul className={s.equipe}>
              {b.profissionais.map((pr) => (
                <li key={pr.id} className={s.membro}>
                  <div className={s.medalhao}>
                    {pr.foto_url ? (
                      <img src={pr.foto_url} alt={pr.nome} loading="lazy" decoding="async" />
                    ) : (
                      <span>{iniciais(pr.nome)}</span>
                    )}
                  </div>
                  <p className={s.membroNome}>{pr.nome}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4. Sobre */}
        {p.sobre.length > 0 && (
          <section className={s.secao} id="sobre" aria-labelledby="t-sobre">
            <Titulo id="t-sobre">Nossa história</Titulo>
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
            <Titulo id="t-galeria">Galeria</Titulo>
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
          <Titulo id="t-contato">Onde estamos</Titulo>
          <div className={s.cartao}>
            {(b.endereco || b.cidade) && (
              <div className={s.cartaoBloco}>
                <h3>
                  <IconeLocal tamanho={18} /> Endereço
                </h3>
                <p>
                  {b.endereco}
                  {b.endereco && b.cidade && <br />}
                  {b.cidade}
                </p>
                {p.mapaHref && (
                  <a className={s.link} href={p.mapaHref} target="_blank" rel="noopener noreferrer">
                    Como chegar
                  </a>
                )}
              </div>
            )}
            {p.horarios.length > 0 && (
              <div className={s.cartaoBloco}>
                <h3>
                  <IconeRelogio tamanho={18} /> Horários
                </h3>
                <dl className={s.horarios}>
                  {p.horarios.map((h) => (
                    <div key={h.dias}>
                      <dt>{h.dias}</dt>
                      <dd>{h.horario}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className={s.cartaoBotoes}>
              {p.whatsapp && (
                <a className={s.botao} href={p.whatsapp.href} target="_blank" rel="noopener noreferrer">
                  <IconeWhatsapp tamanho={18} /> WhatsApp
                </a>
              )}
              {p.instagram && (
                <a className={s.botaoSecundario} href={p.instagram.url} target="_blank" rel="noopener noreferrer">
                  <IconeInstagram tamanho={18} /> {p.instagram.usuario}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className={s.rodape}>
        <Ornamento />
        <p>
          {b.nome} · {new Date().getFullYear()}
        </p>
      </footer>
      <div className={s.listras} aria-hidden />

      <div className={s.ctaFixo}>
        <a className={s.botao} href={p.agendarHref}>
          Agendar horário
        </a>
      </div>
    </div>
  );
}

function Titulo({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className={s.cabecalho}>
      <h2 id={id} className={s.tituloSecao}>
        {children}
      </h2>
      <Ornamento />
    </div>
  );
}

function Ornamento() {
  return (
    <svg className={s.ornamento} viewBox="0 0 160 16" aria-hidden>
      <path d="M0 8h58M102 8h58" />
      <path d="M64 8c6-7 12-7 16 0 4 7 10 7 16 0-6-7-12-7-16 0-4 7-10 7-16 0Z" />
      <circle cx="80" cy="8" r="2" />
    </svg>
  );
}

function Estrela() {
  return (
    <svg className={s.estrela} viewBox="0 0 10 10" aria-hidden>
      <path d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8Z" />
    </svg>
  );
}
