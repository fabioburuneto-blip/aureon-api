import { describe, expect, it } from "vitest";
import { decideDeliveryOutcome, MAX_ATTEMPTS, nextRetryDelayMs } from "./retry.ts";

const now = new Date("2026-01-01T12:00:00.000Z");

describe("decideDeliveryOutcome", () => {
  it("marks a successful send as sent, with attempts incremented and no further retry", () => {
    const outcome = decideDeliveryOutcome({ ok: true }, 0, now);
    expect(outcome.status).toBe("sent");
    expect(outcome.attempts).toBe(1);
    expect(outcome.lastError).toBeNull();
    expect(outcome.nextAttemptAt).toBeNull();
    expect(outcome.sentAt).toEqual(now);
  });

  it.each([
    "provider_unavailable",
    "timeout",
    "rate_limited",
  ] as const)(
    "retries a transient failure (%s) before the attempt cap, with backoff",
    (reason) => {
      const outcome = decideDeliveryOutcome({ ok: false, reason }, 0, now);
      expect(outcome.status).toBe("retrying");
      expect(outcome.attempts).toBe(1);
      expect(outcome.lastError).toBe(reason);
      expect(outcome.nextAttemptAt).not.toBeNull();
      expect(outcome.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(outcome.sentAt).toBeNull();
    },
  );

  it.each(["invalid_token", "invalid_recipient"] as const)(
    "never retries a non-retryable failure (%s) -- fails on the very first attempt",
    (reason) => {
      const outcome = decideDeliveryOutcome({ ok: false, reason }, 0, now);
      expect(outcome.status).toBe("failed");
      expect(outcome.attempts).toBe(1);
      expect(outcome.lastError).toBe(reason);
      expect(outcome.nextAttemptAt).toBeNull();
    },
  );

  it("stops retrying a transient failure once MAX_ATTEMPTS is reached", () => {
    const outcome = decideDeliveryOutcome(
      { ok: false, reason: "provider_unavailable" },
      MAX_ATTEMPTS - 1,
      now,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.attempts).toBe(MAX_ATTEMPTS);
    expect(outcome.nextAttemptAt).toBeNull();
  });

  it("never marks a delivery failed permanently before MAX_ATTEMPTS on a transient failure", () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt++) {
      const outcome = decideDeliveryOutcome(
        { ok: false, reason: "timeout" },
        attempt,
        now,
      );
      expect(outcome.status).toBe("retrying");
    }
  });

  it("increases the backoff delay as attempts accumulate, capped", () => {
    const delays = [0, 1, 2, 3, 4, 5].map((n) => nextRetryDelayMs(n));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(60 * 60_000);
  });
});
