/**
 * Runtime-agnostic types and the NotificationProvider abstraction. This
 * file (and everything else in this directory except providers/*.ts, which
 * only add a `fetch` call) uses zero Deno- or Node-specific APIs on
 * purpose, so the exact same logic can run inside the Edge Function
 * (Deno) and be unit-tested from the Next.js app's Vitest suite (Node)
 * without any adapter layer.
 */

export type NotificationChannel = "in_app" | "email" | "whatsapp";

export type NotificationEventType =
  | "appointment.created"
  | "appointment.confirmed"
  | "appointment.cancelled"
  | "appointment.rescheduled"
  | "appointment.completed"
  | "appointment.no_show"
  | "appointment.reminder_24h"
  | "appointment.reminder_2h";

export type DeliveryStatus = "pending" | "sent" | "failed" | "retrying";

/** Template variables only -- never a token, never a raw provider payload. */
export interface NotificationPayload {
  customer_name: string;
  service_name: string;
  professional_name: string;
  date_label: string;
  time_label: string;
  business_name: string;
}

export interface NotificationMessage {
  /** Used as the email subject / in-app title. */
  title: string;
  /** Full message body (WhatsApp text, email plain-text body). */
  body: string;
}

export interface SendInput {
  recipient: string;
  event: NotificationEventType;
  payload: NotificationPayload;
}

/** A safe, closed vocabulary of failure reasons -- a provider must map
 * whatever it gets from the network/SDK into one of these before
 * returning, so nothing sensitive (tokens, stack traces, raw response
 * bodies) ever reaches the database's last_error column. */
export type SendFailureReason =
  | "timeout"
  | "provider_unavailable"
  | "invalid_token"
  | "invalid_recipient"
  | "rate_limited"
  | "unknown_error";

export type SendResult =
  | { ok: true }
  | { ok: false; reason: SendFailureReason };

/**
 * The one abstraction every channel implements. Swapping the WhatsApp
 * vendor later (Cloud API -> a BSP like Twilio/360dialog) means writing a
 * new class that satisfies this interface and wiring it up in the Edge
 * Function's provider registry -- nothing else in the system changes.
 */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(input: SendInput): Promise<SendResult>;
}
