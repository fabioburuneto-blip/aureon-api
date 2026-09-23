import type { SiteProps } from '@/lib/site';
import { duracao, iniciais, preco } from '@/lib/formatar';
import { IconeInstagram, IconeLocal, IconeRelogio, IconeWhatsapp } from '@/components/site/Icones';
import s from './luxo.module.css';

export function Luxo(p: SiteProps) {
  const { b } = p;
  const { tema } = b;

  return (
    <div className={s.site}>
      {/* 1. Hero */}
      <header className={`${s.hero} ${tema.foto_capa_url ? '' : s.heroSemCapa}`}>
        {tema.foto_capa_url && (
          <img className={s.capa} src={tema.foto_capa_url} alt="" fetchPriority="high" decoding="async" />
        )}
        <div className={s.heroConteudo}>
          {tema.logo_url && <img className={s.logo} src={tema.logo_url} alt={b.nome} width={104} height={104} />}
          <p className={s.sobrelinha}>{b.nome}</p>
          <h1 className={s.titulo}>{p.titulo}</h1>
          {p.subtitulo && <p className={s.subtitulo}>{p.subtitulo}</p>}
          <a className={s.botao} href={p.agendarHref}>
            Agendar horário
          </a>
        </div>
        <span className={s.rolar} aria-hidden />
      </header>

      <main>
        {/* 2. Serviços */}
        <section className={s.secao} id="servicos" aria-labelledby="t-servicos">
          <Cabecalho id="t-servicos" rotulo="Menu" titulo="Serviços e preços" />
          <ul className={s.servicos}>
            {b.servicos.map((sv) => (
              <li key={sv.id} className={`${s.servico} ${s.revelar}`}>
                <div className={s.servicoLinha}>
                  <h3 className={s.servicoNome}>{sv.nome}</h3>
                  <span className={s.pontilhado} aria-hidden />
                  <span className={s.servicoPreco}>{preco(sv.preco)}</span>
                </div>
                <p className={s.servicoInfo}>
                  {sv.descricao && <span>{sv.descricao}</span>}
                  <span className={s.servicoDuracao}>{duracao(sv.duracao_min)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3. Equipe */}
        {p.mostrarEquipe && (
          <section className={s.secao} id="equipe" aria-labelledby="t-equipe">
            <Cabecalho id="t-equipe" rotulo="Mestres" titulo="Nossa equipe" />
            <ul className={s.equipe}>
              {b.profissionais.map((pr) => (
                <li key={pr.id} className={`${s.membro} ${s.revelar}`}>
                  <div className={s.membroFoto}>
                    {pr.foto_url ? (
                      <img src={pr.foto_url} alt={pr.nome} loading="lazy" decoding="async" />
                    ) : (
                      <span className={s.iniciais}>{iniciais(pr.nome)}</span>
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
          <section className={`${s.secao} ${s.sobre}`} id="sobre" aria-labelledby="t-sobre">
            <Cabecalho id="t-sobre" rotulo="A casa" titulo="Sobre nós" />
            <div className={`${s.sobreTexto} ${s.revelar}`}>
              {p.sobre.map((par, i) => (
                <p key={i}>{par}</p>
              ))}
            </div>
          </section>
        )}

        {/* 5. Galeria */}
        {p.mostrarGaleria && (
          <section className={s.secao} id="galeria" aria-labelledby="t-galeria">
            <Cabecalho id="t-galeria" rotulo="Portfólio" titulo="Galeria" />
            <ul className={s.galeria}>
              {tema.galeria.map((url, i) => (
                <li key={url + i} className={s.revelar}>
                  <img src={url} alt={`${b.nome} — foto ${i + 1}`} loading="lazy" decoding="async" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 6. Localização e contato */}
        <section className={s.secao} id="contato" aria-labelledby="t-contato">
          <Cabecalho id="t-contato" rotulo="Visite-nos" titulo="Localização e contato" />
          <div className={`${s.contato} ${s.revelar}`}>
            {(b.endereco || b.cidade) && (
              <div className={s.contatoBloco}>
                <IconeLocal className={s.contatoIcone} />
                <h3>Endereço</h3>
                <p>
                  {b.endereco}
                  {b.endereco && b.cidade && <br />}
                  {b.cidade}
                </p>
                {p.mapaHref && (
                  <a className={s.linkSutil} href={p.mapaHref} target="_blank" rel="noopener noreferrer">
                    Ver no mapa
                  </a>
                )}
              </div>
            )}
            {p.horarios.length > 0 && (
              <div className={s.contatoBloco}>
                <IconeRelogio className={s.contatoIcone} />
                <h3>Horários</h3>
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
            <div className={s.contatoBloco}>
              <IconeWhatsapp className={s.contatoIcone} />
              <h3>Contato</h3>
              <div className={s.contatoBotoes}>
                {p.whatsapp && (
                  <a className={s.botao} href={p.whatsapp.href} target="_blank" rel="noopener noreferrer">
                    <IconeWhatsapp tamanho={18} /> WhatsApp
                  </a>
                )}
                {p.instagram && (
                  <a className={s.botaoContorno} href={p.instagram.url} target="_blank" rel="noopener noreferrer">
                    <IconeInstagram tamanho={18} /> {p.instagram.usuario}
                  </a>
                )}
              </div>
            </div>
            )}
          </div>
        </section>
      </main>

      <footer className={s.rodape}>
        <span className={s.rodapeLinha} aria-hidden />
        <p>
          © {new Date().getFullYear()} {b.nome}
        </p>
      </footer>

      <div className={s.ctaFixo}>
        <a className={s.botao} href={p.agendarHref}>
          Agendar horário
        </a>
      </div>
    </div>
  );
}

function Cabecalho({ id, rotulo, titulo }: { id: string; rotulo: string; titulo: string }) {
  return (
    <div className={`${s.cabecalho} ${s.revelar}`}>
      <p className={s.rotulo}>{rotulo}</p>
      <h2 id={id} className={s.tituloSecao}>
        {titulo}
      </h2>
      <span className={s.filete} aria-hidden />
    </div>
  );
}
