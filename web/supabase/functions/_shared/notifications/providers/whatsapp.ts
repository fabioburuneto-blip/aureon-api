import type {
  NotificationChannel,
  NotificationProvider,
  SendInput,
  SendResult,
} from "../types.ts";
import { renderMessage } from "../templates.ts";
import { fetchWithTimeout, isAbortError } from "../http.ts";

/**
 * WhatsApp Cloud API (Meta) implementation of NotificationProvider. To swap
 * to a different BSP later (Twilio, 360dialog, etc.), write a new class
 * with the same `channel`/`send` shape and swap the construction in
 * supabase/functions/process-notifications/index.ts -- nothing else in the
 * system (the queue, the dashboard, the templates) needs to change.
 *
 * Credentials are never hardcoded or read from the database: they are
 * passed in from the caller, which in production reads them from Edge
 * Function secrets (see docs/NOTIFICATIONS.md).
 */
export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  /** Overridable for tests and for self-hosted/alternate BSPs that speak
   * the same Cloud API shape. Defaults to Meta's Graph API. */
  apiBaseUrl?: string;
  timeoutMs?: number;
}

export class WhatsAppProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "whatsapp";

  constructor(private readonly config: WhatsAppConfig) {}

  async send(input: SendInput): Promise<SendResult> {
    const to = normalizePhone(input.recipient);
    if (!to) {
      return { ok: false, reason: "invalid_recipient" };
    }

    const message = renderMessage(input.event, input.payload);
    const baseUrl = this.config.apiBaseUrl ?? "https://graph.facebook.com/v20.0";
    const url = `${baseUrl}/${this.config.phoneNumberId}/messages`;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: message.body },
          }),
        },
        this.config.timeoutMs ?? 10_000,
      );
    } catch (error) {
      return { ok: false, reason: isAbortError(error) ? "timeout" : "provider_unavailable" };
    }

    if (response.ok) {
      return { ok: true };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "invalid_token" };
    }
    if (response.status === 400 || response.status === 404) {
      return { ok: false, reason: "invalid_recipient" };
    }
    if (response.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    return { ok: false, reason: "provider_unavailable" };
  }
}

/** WhatsApp Cloud API expects digits only (country code + number, no `+`,
 * spaces or punctuation). Returns null for anything that clearly isn't a
 * phone number instead of sending garbage upstream. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
