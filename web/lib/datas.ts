// Datas no fuso da barbearia (America/Sao_Paulo), independente do fuso do servidor/celular.
// Brasil não tem horário de verão desde 2019: o deslocamento é sempre -03:00.

export const FUSO = 'America/Sao_Paulo';
const OFFSET = '-03:00';

const fIso = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }); // AAAA-MM-DD

/** "2026-09-24" de um instante (padrão: agora) */
export function diaSP(instante: Date | string = new Date()): string {
  return fIso.format(typeof instante === 'string' ? new Date(instante) : instante);
}

export function validarDia(v: string | undefined | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00${OFFSET}`)) ? v : null;
}

/** Início do dia (00:00 em SP) como ISO UTC */
export function inicioDoDia(dia: string): string {
  return new Date(`${dia}T00:00:00${OFFSET}`).toISOString();
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return diaSP(d);
}

/** 0 = domingo … 6 = sábado */
export function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00${OFFSET}`).getUTCDay();
}

/** Segunda-feira da semana do dia */
export function inicioDaSemana(dia: string): string {
  const dow = diaDaSemana(dia);
  return somarDias(dia, dow === 0 ? -6 : 1 - dow);
}

const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...o });
const fHora = f({ hour: '2-digit', minute: '2-digit' });
const fDiaLongo = f({ weekday: 'long', day: 'numeric', month: 'long' });
const fDiaCurto = f({ weekday: 'short', day: '2-digit', month: '2-digit' });
const fDataHora = f({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fData = f({ day: '2-digit', month: '2-digit', year: 'numeric' });

const meio = (dia: string) => new Date(`${dia}T12:00:00${OFFSET}`);

export const hora = (instante: string) => fHora.format(new Date(instante));
export const diaLongo = (dia: string) => fDiaLongo.format(meio(dia));
export const diaCurto = (dia: string) => fDiaCurto.format(meio(dia)).replace('.', '');
export const dataHora = (instante: string) => fDataHora.format(new Date(instante));
export const dataCurta = (instante: string) => fData.format(new Date(instante));

/** "2026-09-24" + "09:30" → ISO do instante em SP */
export function instanteSP(dia: string, horaMin: string): string {
  return new Date(`${dia}T${horaMin}:00${OFFSET}`).toISOString();
}

/** Valor para <input type="datetime-local"> a partir de um instante */
export function paraDatetimeLocal(instante: string): string {
  const d = new Date(instante);
  return `${diaSP(d)}T${fHora.format(d)}`;
}

/** Valor de <input type="datetime-local"> (horário de SP) → ISO */
export function deDatetimeLocal(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return new Date(`${v}:00${OFFSET}`).toISOString();
}
