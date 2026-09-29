/**
 * Minimal RFC 5545 .ics generator for "add to calendar" on the booking
 * success screen and the /agendamento/[token] page. Deliberately not an
 * integration with any calendar provider's API (no OAuth, no Google
 * Calendar API) -- just a static file the browser can download and hand
 * to whatever calendar app the visitor already has, which is the
 * "simple and safe" option Etapa 3 asks for instead of a real Google
 * Calendar integration.
 */
export interface IcsEvent {
  title: string;
  description?: string;
  location?: string;
  /** ISO 8601 instant (UTC or with offset) -- always converted to ICS's
   * UTC `Z` form internally, never assumed to already be in that shape. */
  startsAtIso: string;
  endsAtIso: string;
}

function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapes text per RFC 5545 3.3.11 -- backslash, semicolon, comma, then
 * newlines, in that order (escaping newline first would double-escape
 * the backslash it introduces). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcsContent(event: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aureon Agenda//Booking//PT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${toIcsUtc(event.startsAtIso)}-${Math.random().toString(36).slice(2)}@aureon-agenda`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(event.startsAtIso)}`,
    `DTEND:${toIcsUtc(event.endsAtIso)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  // ICS requires CRLF line endings.
  return lines.join("\r\n");
}

export function buildIcsDataUrl(event: IcsEvent): string {
  const content = buildIcsContent(event);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
}
