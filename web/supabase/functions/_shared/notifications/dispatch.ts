import type { NotificationChannel, NotificationProvider, SendInput } from "./types.ts";
import { decideDeliveryOutcome, type DeliveryOutcome } from "./retry.ts";

/**
 * One delivery attempt: calls the right provider for the row's channel and
 * turns the result into a persistable outcome (status/attempts/last_error/
 * next_attempt_at/sent_at). This is what the process-notifications worker
 * calls per pending row -- it never throws: a provider that rejects
 * unexpectedly is treated as `provider_unavailable` rather than crashing
 * the caller's loop, so one bad delivery can never stop the rest of the
 * queue from being processed.
 */
export async function dispatchDelivery(
  providers: Partial<Record<NotificationChannel, NotificationProvider>>,
  row: { channel: NotificationChannel; attempts: number } & SendInput,
  now: Date = new Date(),
): Promise<DeliveryOutcome> {
  const provider = providers[row.channel];

  if (!provider) {
    return decideDeliveryOutcome(
      { ok: false, reason: "provider_unavailable" },
      row.attempts,
      now,
    );
  }

  try {
    const result = await provider.send(row);
    return decideDeliveryOutcome(result, row.attempts, now);
  } catch {
    // A provider implementation should never throw (send() returns a
    // SendResult for every case it handles) -- this is the last-resort
    // safety net for a truly unexpected error, so it degrades the same as
    // any other unavailable-provider failure instead of propagating.
    return decideDeliveryOutcome(
      { ok: false, reason: "provider_unavailable" },
      row.attempts,
      now,
    );
  }
}
