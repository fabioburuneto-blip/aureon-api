import type {
  NotificationChannel,
  NotificationProvider,
  SendInput,
  SendResult,
} from "../types.ts";

/**
 * In-app "delivery" already happened synchronously: the
 * trg_appointments_notify trigger inserts the notifications row in the
 * same transaction as the appointment write, so it's visible in the
 * dashboard bell immediately and can never be "down" the way WhatsApp or
 * email can. This class exists only so in-app satisfies the same
 * NotificationProvider interface as the other two channels (the product
 * asked for "in-app, email, whatsapp" behind one abstraction) -- the
 * queue/worker never actually needs to invoke it, since there is no
 * notification_deliveries row for channel = 'in_app'.
 */
export class InAppProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "in_app";

  async send(input: SendInput): Promise<SendResult> {
    void input;
    return { ok: true };
  }
}
