import type { Barbearia, DiaFuncionamento } from './barbearia';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function preco(valor: number): string {
  return BRL.format(Number(valor));
}

/** "R$ 375" quando não há centavos (para espaços apertados), senão "R$ 375,50". */
export function precoCurto(valor: number): string {
  const v = Number(valor);
  return Number.isInteger(v) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v) : preco(v);
}

export function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export function linkWhatsapp(numero: string | null, mensagem?: string): string | null {
  if (!numero) return null;
  let d = numero.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `https://wa.me/${d}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
}

export function whatsappFormatado(numero: string | null): string | null {
  if (!numero) return null;
  const d = numero.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero;
}

export function instagram(valor: string | null): { usuario: string; url: string } | null {
  if (!valor) return null;
  const usuario = valor
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9._]{1,30}$/.test(usuario)) return null;
  return { usuario: `@${usuario}`, url: `https://instagram.com/${usuario}` };
}

export function linkMapa(endereco: string | null, cidade: string | null): string | null {
  const q = [endereco, cidade].filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ORDEM = [1, 2, 3, 4, 5, 6, 0]; // semana começando na segunda

function valorDia(d: DiaFuncionamento | undefined): string {
  if (!d || !d.aberto || !d.abre || !d.fecha) return 'Fechado';
  return `${d.abre} – ${d.fecha}`;
}

/** Agrupa dias consecutivos com o mesmo horário: "Ter a Sex · 09:00 – 20:00". */
export function horarios(h: Barbearia['horario_funcionamento']): { dias: string; horario: string }[] {
  if (!h || typeof h !== 'object' || !Object.keys(h).length) return [];
  const grupos: { de: number; ate: number; horario: string }[] = [];
  for (const dia of ORDEM) {
    const horario = valorDia(h[String(dia)]);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.horario === horario) ultimo.ate = dia;
    else grupos.push({ de: dia, ate: dia, horario });
  }
  return grupos.map((g) => ({
    dias:
      g.de === g.ate
        ? DIAS[g.de]
        : ORDEM.indexOf(g.ate) - ORDEM.indexOf(g.de) === 1
          ? `${DIAS[g.de]} e ${DIAS[g.ate]}`
          : `${DIAS[g.de]} a ${DIAS[g.ate]}`,
    horario: g.horario,
  }));
}

/** Parágrafos do texto_sobre (quebras de linha duplas). */
export function paragrafos(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
