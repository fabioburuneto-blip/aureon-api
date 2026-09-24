// Utilitários do fluxo de agendamento (sem dependências de servidor: roda no navegador).

export const FUSO = 'America/Sao_Paulo';

export type DiaDisponivel = { data: string; horarios: number };
export type HorarioLivre = { inicio: string; fim: string; hora: string; profissionais: string[] };

export type Confirmacao = {
  ok: true;
  agendamento: { id: string; inicio: string; fim: string; data: string; hora: string; status: string; preco: number };
  barbearia: { nome: string; slug: string; whatsapp: string | null; endereco: string | null; cidade: string | null };
  servico: { id: string; nome: string; preco: number; duracao_min: number };
  profissional: { id: string; nome: string; foto_url: string | null };
  cliente: { nome: string; telefone: string };
};

export type ErroAgendamento = { ok: false; codigo: string; mensagem: string };

/** Códigos que significam "escolha outro horário". */
export const CODIGOS_HORARIO = ['horario_indisponivel', 'horario_passado'];

// ---------------------------------------------------------------------------
// Telefone (máscara brasileira)
// ---------------------------------------------------------------------------

export function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

/** "(11) 91234-5678" para celular e "(11) 3456-7890" para fixo, formatando enquanto digita. */
export function mascaraTelefone(valor: string): string {
  let d = soDigitos(valor);
  // quem cola "+55 11 9..." ou "5511..." com 12–13 dígitos: remove o 55
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Retorna mensagem de erro ou null se válido. */
export function validarTelefone(valor: string): string | null {
  const d = soDigitos(valor);
  if (!d) return 'Informe seu WhatsApp.';
  if (d.length < 10) return 'Número incompleto. Inclua o DDD.';
  if (!/^[1-9]{2}/.test(d)) return 'DDD inválido.';
  if (d.length === 11 && d[2] !== '9') return 'Celular deve começar com 9 depois do DDD.';
  return null;
}

export function validarNome(valor: string): string | null {
  const n = valor.trim();
  if (n.length < 2) return 'Informe seu nome.';
  if (n.length > 100) return 'Nome muito longo.';
  return null;
}

// ---------------------------------------------------------------------------
// Datas (sempre no fuso da barbearia, independente do fuso do celular)
// ---------------------------------------------------------------------------

/** "2026-09-24" → Date ao meio-dia de São Paulo (evita virar o dia em outros fusos). */
function dataLocal(iso: string): Date {
  return new Date(`${iso}T12:00:00-03:00`);
}

const fmt = (opcoes: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes });
const fDiaSemanaCurto = fmt({ weekday: 'short' });
const fDiaMes = fmt({ day: 'numeric' });
const fMesCurto = fmt({ month: 'short' });
const fDataLonga = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDataCurta = fmt({ weekday: 'short', day: '2-digit', month: '2-digit' });
const fHora = fmt({ hour: '2-digit', minute: '2-digit' });

const semPonto = (s: string) => s.replace('.', '');

export function partesDia(iso: string) {
  const d = dataLocal(iso);
  return {
    semana: semPonto(fDiaSemanaCurto.format(d)),
    dia: fDiaMes.format(d),
    mes: semPonto(fMesCurto.format(d)),
  };
}

/** "quinta-feira, 24 de setembro" */
export function dataLonga(iso: string): string {
  return fDataLonga.format(dataLocal(iso));
}

/** "qui., 24/09" a partir de um instante (timestamptz) */
export function dataCurtaInstante(instante: string): string {
  return fDataCurta.format(new Date(instante));
}

export function horaInstante(instante: string): string {
  return fHora.format(new Date(instante));
}

/** Manhã (até 12h), Tarde (até 18h), Noite */
export function periodo(hora: string): 'Manhã' | 'Tarde' | 'Noite' {
  const h = Number(hora.slice(0, 2));
  return h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite';
}

// ---------------------------------------------------------------------------
// Links pós-agendamento
// ---------------------------------------------------------------------------

function utcCompacto(instante: string): string {
  return new Date(instante).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function linkGoogleAgenda(c: Confirmacao): string {
  const local = [c.barbearia.endereco, c.barbearia.cidade].filter(Boolean).join(', ');
  const detalhes = [
    `${c.servico.nome} com ${c.profissional.nome}`,
    c.barbearia.whatsapp ? `WhatsApp da barbearia: ${c.barbearia.whatsapp}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${c.servico.nome} · ${c.barbearia.nome}`,
    dates: `${utcCompacto(c.agendamento.inicio)}/${utcCompacto(c.agendamento.fim)}`,
    details: detalhes,
    location: local,
    ctz: FUSO,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function mensagemWhatsapp(c: Confirmacao): string {
  return [
    `Olá, ${c.barbearia.nome}! Acabei de agendar pelo site:`,
    '',
    `✂️ ${c.servico.nome} com ${c.profissional.nome}`,
    `📅 ${dataCurtaInstante(c.agendamento.inicio)} às ${c.agendamento.hora}`,
    `👤 ${c.cliente.nome}`,
    '',
    'Até lá!',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Lembrar nome e telefone neste aparelho (conveniência; falhas são ignoradas)
// ---------------------------------------------------------------------------

const CHAVE = 'agendamento:cliente';

export function lerClienteSalvo(): { nome: string; telefone: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
    return v && typeof v.nome === 'string' && typeof v.telefone === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function salvarCliente(nome: string, telefone: string) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ nome, telefone }));
  } catch {
    /* modo privado etc. */
  }
}
