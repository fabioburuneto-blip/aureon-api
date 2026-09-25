import type { DeliveryStatus, SendFailureReason, SendResult } from "./types.ts";

/** After this many attempts, a failure is terminal (status becomes
 * 'failed' instead of 'retrying') -- the worker never retries forever. */
export const MAX_ATTEMPTS = 5;

/** Exponential backoff, capped at 1 hour: 1m, 5m, 20m, 60m, 60m, ... */
const BACKOFF_MINUTES = [1, 5, 20, 60];

export function nextRetryDelayMs(attemptsSoFar: number): number {
  const minutes =
    BACKOFF_MINUTES[Math.min(attemptsSoFar, BACKOFF_MINUTES.length - 1)];
  return minutes * 60_000;
}

/** Failure reasons that are pointless to retry (the input itself is bad,
 * not a transient provider/network issue) -- these go straight to
 * 'failed' on the first attempt instead of burning through retries. */
const NON_RETRYABLE_REASONS: SendFailureReason[] = [
  "invalid_token",
  "invalid_recipient",
];

export interface DeliveryOutcome {
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
}

/**
 * The whole retry/backoff state machine, decided from pure inputs so every
 * failure mode (provider down, timeout, bad token, bad phone number) can be
 * asserted on directly in a test without touching a network or a database.
 * `now` is injected (defaults to `new Date()`) purely so tests can pin it.
 */
export function decideDeliveryOutcome(
  result: SendResult,
  previousAttempts: number,
  now: Date = new Date(),
): DeliveryOutcome {
  const attempts = previousAttempts + 1;

  if (result.ok) {
    return {
      status: "sent",
      attempts,
      lastError: null,
      nextAttemptAt: null,
      sentAt: now,
    };
  }

  const terminal =
    NON_RETRYABLE_REASONS.includes(result.reason) || attempts >= MAX_ATTEMPTS;

  if (terminal) {
    return {
      status: "failed",
      attempts,
      lastError: result.reason,
      nextAttemptAt: null,
      sentAt: null,
    };
  }

  return {
    status: "retrying",
    attempts,
    lastError: result.reason,
    nextAttemptAt: new Date(now.getTime() + nextRetryDelayMs(attempts - 1)),
    sentAt: null,
  };
}
