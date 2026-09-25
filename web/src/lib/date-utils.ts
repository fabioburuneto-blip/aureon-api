/**
 * Plain-JS date-key helpers for the dashboard calendar (day/week/month
 * views). No date library dependency -- everything works off "YYYY-MM-DD"
 * keys interpreted as local wall-clock midnight, matching how the rest of
 * the dashboard already parses `${dateKey}T00:00:00`.
 */

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

export function isValidDateKey(key: string | undefined): key is string {
  return !!key && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function addMonths(dateKey: string, months: number): string {
  const date = parseDateKey(dateKey);
  date.setMonth(date.getMonth() + months);
  return toDateKey(date);
}

/** Monday-first weekday index: 0 = Monday .. 6 = Sunday. */
export function weekdayIndexMondayFirst(dateKey: string): number {
  const jsDay = parseDateKey(dateKey).getDay(); // 0 = Sunday .. 6 = Saturday
  return (jsDay + 6) % 7;
}

export function startOfWeekKey(dateKey: string): string {
  return addDays(dateKey, -weekdayIndexMondayFirst(dateKey));
}

export function startOfMonthKey(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function daysInMonth(dateKey: string): number {
  const date = parseDateKey(dateKey);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function dayRangeISO(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(`${dateKey}T23:59:59.999`);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
}

export function rangeISO(fromKey: string, toKey: string) {
  const start = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T23:59:59.999`);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
}

/** Calendar-day key ("YYYY-MM-DD") a timestamp falls on in a given timezone
 * -- used to group appointments into day/week/month cells consistently with
 * how their times are displayed (formatTime/formatDateTime use the same
 * business timezone). */
export function localDateKeyFromISO(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** "HH:MM" a timestamp falls on in a given timezone -- pairs with
 * localDateKeyFromISO to prefill date/time inputs with the same wall-clock
 * value already shown elsewhere on the page via formatTime/formatDateTime. */
export function localTimeFromISO(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export const WEEKDAY_SHORT_LABELS_MON_FIRST = [
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
  "Dom",
] as const;
