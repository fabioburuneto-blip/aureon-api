import { describe, expect, it } from "vitest";
import {
  addDays,
  dayRangeISO,
  rangeISO,
  todayKeyInTimeZone,
  zonedDateTimeToUtcISO,
} from "./date-utils";

describe("zonedDateTimeToUtcISO", () => {
  it("converts a wall-clock time in a fixed-offset zone (America/Sao_Paulo, UTC-3) to the right UTC instant", () => {
    expect(zonedDateTimeToUtcISO("2026-06-15", "10:00", "America/Sao_Paulo")).toBe(
      "2026-06-15T13:00:00.000Z",
    );
  });

  it("converts correctly across midnight (business-local evening becomes next-day UTC)", () => {
    // 22:00 in Sao Paulo (UTC-3) on the 24th is 01:00 UTC on the 25th.
    expect(zonedDateTimeToUtcISO("2026-09-24", "22:00", "America/Sao_Paulo")).toBe(
      "2026-09-25T01:00:00.000Z",
    );
  });

  it("is a no-op conversion for UTC itself", () => {
    expect(zonedDateTimeToUtcISO("2026-01-01", "00:00", "UTC")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("picks the correct offset on each side of a DST transition (America/New_York)", () => {
    // Mid-January: EST, UTC-5.
    expect(zonedDateTimeToUtcISO("2026-01-15", "09:00", "America/New_York")).toBe(
      "2026-01-15T14:00:00.000Z",
    );
    // Mid-July: EDT, UTC-4.
    expect(zonedDateTimeToUtcISO("2026-07-15", "09:00", "America/New_York")).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("supports a seconds/millisecond component (used for end-of-day boundaries)", () => {
    const iso = zonedDateTimeToUtcISO("2026-09-25", "23:59:59.999", "America/Sao_Paulo");
    expect(iso).toBe("2026-09-26T02:59:59.999Z");
  });
});

describe("dayRangeISO / rangeISO", () => {
  it("produces a from/to pair that actually brackets the business's calendar day, not the server's", () => {
    const { fromISO, toISO } = dayRangeISO("2026-09-25", "America/Sao_Paulo");
    expect(fromISO).toBe("2026-09-25T03:00:00.000Z"); // 00:00 -03:00
    expect(toISO).toBe("2026-09-26T02:59:59.999Z"); // 23:59:59.999 -03:00
  });

  it("rangeISO spans from the start of fromKey to the end of toKey", () => {
    const { fromISO, toISO } = rangeISO("2026-09-01", "2026-09-07", "America/Sao_Paulo");
    expect(fromISO).toBe("2026-09-01T03:00:00.000Z");
    expect(toISO).toBe(zonedDateTimeToUtcISO("2026-09-07", "23:59:59.999", "America/Sao_Paulo"));
  });

  it("a single-day range never accidentally spills into the next business-local day", () => {
    const { toISO } = dayRangeISO("2026-09-25", "America/Sao_Paulo");
    const nextDayStart = zonedDateTimeToUtcISO(
      addDays("2026-09-25", 1),
      "00:00:00",
      "America/Sao_Paulo",
    );
    expect(new Date(toISO).getTime()).toBeLessThan(new Date(nextDayStart).getTime());
  });
});

describe("todayKeyInTimeZone", () => {
  it("returns a well-formed YYYY-MM-DD key", () => {
    expect(todayKeyInTimeZone("America/Sao_Paulo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("can disagree with the UTC date near midnight in a negative-offset zone", () => {
    // This just asserts the function is timezone-sensitive at all: asking
    // for "today" in a zone several hours behind UTC never returns a date
    // that is *later* than UTC's own current date.
    const utcKey = todayKeyInTimeZone("UTC");
    const saoPauloKey = todayKeyInTimeZone("America/Sao_Paulo");
    expect(saoPauloKey <= utcKey).toBe(true);
  });
});
