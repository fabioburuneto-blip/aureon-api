import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("formats minutes under an hour", () => {
    expect(formatDuration(30)).toBe("30min");
    expect(formatDuration(45)).toBe("45min");
  });

  it("formats exact hours with no leftover minutes", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
  });

  it("formats hours with leftover minutes", () => {
    expect(formatDuration(75)).toBe("1h15");
    expect(formatDuration(90)).toBe("1h30");
  });
});
