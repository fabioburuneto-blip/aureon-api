/**
 * Plain-JS date-key ("YYYY-MM-DD") helpers for the dashboard calendar
 * (day/week/month views). No date library dependency.
 *
 * Two different kinds of functions live here, and mixing them up is
 * exactly the class of bug this file exists to prevent:
 *  - Pure calendar-math ones (addDays, addMonths, startOfWeekKey, ...)
 *    manipulate a date-key's year/month/day only and are timezone-agnostic
 *    by construction -- "the day after 2026-09-25" is 2026-09-26 no matter
 *    what timezone the process happens to run in.
 *  - Instant-producing ones (dayRangeISO, rangeISO, zonedDateTimeToUtcISO,
 *    todayKeyInTimeZone) turn a date-key into a real point in time, which
 *    depends entirely on a timezone -- these all take a `timeZone`
 *    parameter (always `business.timezone`, never assume the server's own
 *    zone) instead of quietly parsing `${key}T00:00:00` as if the server
 *    and the business shared a clock.
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

/**
 * Converts a wall-clock date-key + "HH:MM"(:SS) time, as understood in
 * `timeZone`, into the real UTC instant it represents -- without a date
 * library. Standard technique: guess the instant assuming UTC, see how
 * that instant reads back when formatted in the target zone, and correct
 * by the difference. Needed because e.g. "14:00 in America/Sao_Paulo" and
 * "14:00 on the server" are frequently different instants (production
 * servers commonly run in UTC while `business.timezone` defaults to
 * America/Sao_Paulo, a fixed 3-hour gap) -- see docs/AUDIT.md.
 */
export function zonedDateTimeToUtcISO(
  dateKey: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hourStr, minuteStr, secondStr = "0"] = time.split(":");
  const wholeSeconds = Math.trunc(Number(secondStr));
  const millis = Math.round((Number(secondStr) - wholeSeconds) * 1000);

  // The offset-discovery round-trip below is done in whole seconds only
  // (Intl.DateTimeFormat's "second" part has no sub-second precision) --
  // milliseconds are added back separately at the end, since a timezone
  // offset is always a whole number of minutes and never depends on them.
  // Folding `millis` into this round-trip instead (i.e. passing it to
  // both Date.UTC calls, or worse, only one of them) desyncs the
  // subtraction by however many ms were in the input, e.g. turning
  // "23:59:59.999" into "...:00.998" a la an off-by-a-hair Y2K bug.
  const guessUtcMs = Date.UTC(
    year,
    month - 1,
    day,
    Number(hourStr),
    Number(minuteStr),
    wholeSeconds,
  );

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guessUtcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asIfLocalMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = asIfLocalMs - guessUtcMs;

  return new Date(guessUtcMs - offsetMs + millis).toISOString();
}

/** Today's date-key ("YYYY-MM-DD") as it is *right now* in the given
 * timezone -- not the server's local date, which can be a day off near
 * midnight whenever the server and the business run in different zones
 * (e.g. a UTC server just after 21:00 America/Sao_Paulo time, still the
 * previous UTC-day). */
export function todayKeyInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** [start of dateKey, end of dateKey] in `timeZone`, both inclusive --
 * matches how every caller already filters (`.gte(fromISO).lte(toISO)`). */
export function dayRangeISO(dateKey: string, timeZone: string) {
  return {
    fromISO: zonedDateTimeToUtcISO(dateKey, "00:00:00", timeZone),
    toISO: zonedDateTimeToUtcISO(dateKey, "23:59:59.999", timeZone),
  };
}

/** [start of fromKey, end of toKey] in `timeZone`, both inclusive. */
export function rangeISO(fromKey: string, toKey: string, timeZone: string) {
  return {
    fromISO: zonedDateTimeToUtcISO(fromKey, "00:00:00", timeZone),
    toISO: zonedDateTimeToUtcISO(toKey, "23:59:59.999", timeZone),
  };
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
