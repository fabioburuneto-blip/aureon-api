// Supabase Edge Function (Deno). Deployed with:
//   supabase functions deploy process-notifications
// Scheduled via pg_cron + pg_net (see docs/NOTIFICATIONS.md) to run every
// few minutes. Drains the notification_deliveries queue: for every row
// still 'pending' or 'retrying' whose next_attempt_at has passed, calls the
// right channel provider and persists the outcome. Never touches the
// appointments table -- by the time a row exists here, the appointment
// write it came from has already committed (see the trg_appointments_notify
// trigger in supabase/migrations/20250924120007_notifications.sql), so a
// slow or failing provider here can never block or roll back a booking.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { NotificationChannel, NotificationProvider } from "../_shared/notifications/types.ts";
import { dispatchDelivery } from "../_shared/notifications/dispatch.ts";
import { WhatsAppProvider } from "../_shared/notifications/providers/whatsapp.ts";
import { EmailProvider } from "../_shared/notifications/providers/email.ts";

const BATCH_SIZE = 50;

function buildProviders(): Partial<Record<NotificationChannel, NotificationProvider>> {
  const providers: Partial<Record<NotificationChannel, NotificationProvider>> = {};

  const waToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const waPhoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (waToken && waPhoneId) {
    providers.whatsapp = new WhatsAppProvider({
      accessToken: waToken,
      phoneNumberId: waPhoneId,
    });
  }

  const emailKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM_ADDRESS");
  if (emailKey && emailFrom) {
    providers.email = new EmailProvider({ apiKey: emailKey, fromAddress: emailFrom });
  }

  // Neither configured yet? Rows for that channel resolve to
  // 'provider_unavailable' via dispatchDelivery's "no provider" branch and
  // retry/eventually fail -- nothing crashes, nothing blocks appointments.
  return providers;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("CRON_SECRET") ?? ""}`;
  if (!Deno.env.get("CRON_SECRET") || authHeader !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const providers = buildProviders();

  const { data: rows, error: fetchError } = await supabase
    .from("notification_deliveries")
    .select("id, channel, event_type, recipient, payload, attempts")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    return Response.json({ error: "failed to fetch queue" }, { status: 500 });
  }

  const summary = { processed: 0, sent: 0, retrying: 0, failed: 0 };

  for (const row of rows ?? []) {
    summary.processed += 1;

    try {
      const outcome = await dispatchDelivery(providers, {
        channel: row.channel,
        recipient: row.recipient,
        event: row.event_type,
        payload: row.payload,
        attempts: row.attempts,
      });

      summary[outcome.status === "sent" ? "sent" : outcome.status === "retrying" ? "retrying" : "failed"] += 1;

      await supabase
        .from("notification_deliveries")
        .update({
          status: outcome.status,
          attempts: outcome.attempts,
          last_error: outcome.lastError,
          next_attempt_at: (outcome.nextAttemptAt ?? new Date()).toISOString(),
          sent_at: outcome.sentAt ? outcome.sentAt.toISOString() : null,
        })
        .eq("id", row.id);
    } catch {
      // A single row's unexpected failure (e.g. a transient DB error on the
      // update itself) must never stop the rest of the batch from being
      // processed -- log-and-continue.
      summary.failed += 1;
    }
  }

  return Response.json(summary);
});
