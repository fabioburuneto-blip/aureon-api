import s from './nao-encontrada.module.css';

/** Página neutra (sem tema, pois não há barbearia). */
export function NaoEncontrada() {
  return (
    <main className={s.pagina}>
      <div className={s.caixa}>
        <svg className={s.icone} viewBox="0 0 64 64" aria-hidden>
          <circle cx="20" cy="46" r="9" />
          <circle cx="44" cy="46" r="9" />
          <path d="M26 39 46 8M38 39 18 8" />
        </svg>
        <h1 className={s.titulo}>Barbearia não encontrada</h1>
        <p className={s.texto}>
          Confira se o endereço foi digitado corretamente. Se o link veio de uma rede social, a barbearia pode ter mudado
          de endereço ou estar temporariamente fora do ar.
        </p>
      </div>
    </main>
  );
}
