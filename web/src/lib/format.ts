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

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;
