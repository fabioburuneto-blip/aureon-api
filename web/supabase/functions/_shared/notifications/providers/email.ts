import type {
  NotificationChannel,
  NotificationProvider,
  SendInput,
  SendResult,
} from "../types.ts";
import { renderMessage } from "../templates.ts";
import { fetchWithTimeout, isAbortError } from "../http.ts";

/**
 * Email delivery via Resend's HTTP API (a simple `POST /emails` with an
 * API key -- no SMTP, no SDK). Any other transactional-email provider with
 * a comparable REST API can replace this by implementing the same
 * NotificationProvider shape; nothing else in the system depends on Resend
 * specifically.
 */
export interface EmailConfig {
  apiKey: string;
  fromAddress: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

export class EmailProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "email";

  constructor(private readonly config: EmailConfig) {}

  async send(input: SendInput): Promise<SendResult> {
    if (!isLikelyEmail(input.recipient)) {
      return { ok: false, reason: "invalid_recipient" };
    }

    const message = renderMessage(input.event, input.payload);
    const baseUrl = this.config.apiBaseUrl ?? "https://api.resend.com";

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/emails`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: this.config.fromAddress,
            to: input.recipient,
            subject: message.title,
            text: message.body,
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
    if (response.status === 400 || response.status === 422) {
      return { ok: false, reason: "invalid_recipient" };
    }
    if (response.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    return { ok: false, reason: "provider_unavailable" };
  }
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
