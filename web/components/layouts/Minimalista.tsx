import type { SiteProps } from '@/lib/site';
import { duracao, iniciais, preco } from '@/lib/formatar';
import { IconeSeta } from '@/components/site/Icones';
import s from './minimalista.module.css';

export function Minimalista(p: SiteProps) {
  const { b } = p;
  const { tema } = b;

  return (
    <div className={s.site}>
      {/* 1. Hero */}
      <header className={s.hero}>
        <div className={s.topo}>
          <span className={s.marca}>
            {tema.logo_url && <img className={s.logo} src={tema.logo_url} alt="" width={36} height={36} />}
            {b.nome}
          </span>
          <a className={s.topoLink} href={p.agendarHref}>
            Agendar
          </a>
        </div>
        {tema.foto_capa_url && (
          <div className={s.capa}>
            <img src={tema.foto_capa_url} alt="" fetchPriority="high" decoding="async" />
          </div>
        )}
        <div className={s.heroTexto}>
          <h1 className={s.titulo}>{p.titulo}</h1>
          <div className={s.heroLado}>
            {p.subtitulo && <p className={s.subtitulo}>{p.subtitulo}</p>}
            <a className={s.botao} href={p.agendarHref}>
              Agendar horário
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* 2. Serviços */}
        <section className={s.secao} id="servicos" aria-labelledby="t-servicos">
          <Cabecalho id="t-servicos" titulo="Serviços" contagem={b.servicos.length} />
          <ul className={s.servicos}>
            {b.servicos.map((sv) => (
              <li key={sv.id} className={s.servico}>
                <div className={s.servicoLinha}>
                  <h3>{sv.nome}</h3>
                  <span className={s.preco}>{preco(sv.preco)}</span>
                </div>
                <p className={s.servicoInfo}>
                  {sv.descricao && <span>{sv.descricao}</span>}
                  <span className={s.duracao}>{duracao(sv.duracao_min)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3. Equipe */}
        {p.mostrarEquipe && (
          <section className={s.secao} id="equipe" aria-labelledby="t-equipe">
            <Cabecalho id="t-equipe" titulo="Equipe" contagem={b.profissionais.length} />
            <ul className={s.equipe}>
              {b.profissionais.map((pr) => (
                <li key={pr.id}>
                  <div className={s.foto}>
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
          <section className={`${s.secao} ${s.secaoSobre}`} id="sobre" aria-labelledby="t-sobre">
            <Cabecalho id="t-sobre" titulo="Sobre" />
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
            <Cabecalho id="t-galeria" titulo="Galeria" contagem={tema.galeria.length} />
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
          <Cabecalho id="t-contato" titulo="Visite" />
          <div className={s.contato}>
            {(b.endereco || b.cidade) && (
              <div>
                <h3 className={s.rotulo}>Endereço</h3>
                <p>{b.endereco}</p>
                {b.cidade && <p className={s.suave}>{b.cidade}</p>}
                {p.mapaHref && (
                  <a className={s.link} href={p.mapaHref} target="_blank" rel="noopener noreferrer">
                    Ver no mapa <IconeSeta tamanho={16} />
                  </a>
                )}
              </div>
            )}
            {p.horarios.length > 0 && (
              <div>
                <h3 className={s.rotulo}>Horários</h3>
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
            {(p.whatsapp || p.instagram) && (
            <div>
              <h3 className={s.rotulo}>Contato</h3>
              {p.whatsapp && (
                <a className={s.link} href={p.whatsapp.href} target="_blank" rel="noopener noreferrer">
                  WhatsApp {p.whatsapp.texto} <IconeSeta tamanho={16} />
                </a>
              )}
              {p.instagram && (
                <a className={s.link} href={p.instagram.url} target="_blank" rel="noopener noreferrer">
                  Instagram {p.instagram.usuario} <IconeSeta tamanho={16} />
                </a>
              )}
            </div>
            )}
          </div>
        </section>
      </main>

      <footer className={s.rodape}>
        <span>{b.nome}</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>

      <div className={s.ctaFixo}>
        <a className={s.botao} href={p.agendarHref}>
          Agendar horário
        </a>
      </div>
    </div>
  );
}

function Cabecalho({ id, titulo, contagem }: { id: string; titulo: string; contagem?: number }) {
  return (
    <div className={s.cabecalho}>
      <h2 id={id}>{titulo}</h2>
      {contagem !== undefined && <span className={s.contagem}>{String(contagem).padStart(2, '0')}</span>}
    </div>
  );
}
