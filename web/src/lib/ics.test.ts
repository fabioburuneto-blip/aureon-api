import { describe, expect, it } from "vitest";
import { buildIcsContent, buildIcsDataUrl } from "./ics";

describe("buildIcsContent", () => {
  const base = {
    title: "Corte + Barba",
    startsAtIso: "2026-10-15T18:00:00.000Z",
    endsAtIso: "2026-10-15T19:00:00.000Z",
  };

  it("produces a well-formed VCALENDAR/VEVENT block", () => {
    const ics = buildIcsContent(base);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("formats start/end as UTC basic ICS timestamps", () => {
    const ics = buildIcsContent(base);
    expect(ics).toContain("DTSTART:20261015T180000Z");
    expect(ics).toContain("DTEND:20261015T190000Z");
  });

  it("escapes commas, semicolons and newlines in text fields", () => {
    const ics = buildIcsContent({
      ...base,
      title: "Corte; Barba, e mais",
      description: "Linha 1\nLinha 2",
    });
    expect(ics).toContain("SUMMARY:Corte\\; Barba\\, e mais");
    expect(ics).toContain("DESCRIPTION:Linha 1\\nLinha 2");
  });

  it("omits DESCRIPTION/LOCATION when not provided", () => {
    const ics = buildIcsContent(base);
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
  });

  it("includes LOCATION when provided", () => {
    const ics = buildIcsContent({ ...base, location: "Rua Exemplo, 123" });
    expect(ics).toContain("LOCATION:Rua Exemplo\\, 123");
  });

  it("uses CRLF line endings as required by RFC 5545", () => {
    const ics = buildIcsContent(base);
    expect(ics).toContain("\r\n");
  });
});

describe("buildIcsDataUrl", () => {
  it("produces a data: URL with the calendar mime type", () => {
    const url = buildIcsDataUrl({
      title: "Corte",
      startsAtIso: "2026-10-15T18:00:00.000Z",
      endsAtIso: "2026-10-15T18:30:00.000Z",
    });
    expect(url.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.split(",")[1]!)).toContain("SUMMARY:Corte");
  });
});
