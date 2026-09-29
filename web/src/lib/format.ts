export function formatPriceCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatDateTime(
  iso: string,
  timeZone = "America/Sao_Paulo",
): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatTime(
  iso: string,
  timeZone = "America/Sao_Paulo",
): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateLong(
  iso: string,
  timeZone = "America/Sao_Paulo",
): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** "1h15", "1h", "45min" -- used on the booking review/success screens so
 * a customer sees "quanto tempo dura" without doing math on start/end. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${remaining}min`;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h${remaining}`;
}

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;
