// Supabase Edge Function (Deno). Deployed with:
//   supabase functions deploy appointment-reminders
// Scheduled via pg_cron + pg_net (see docs/NOTIFICATIONS.md), recommended
// every 10-15 minutes. Scans for appointments approaching the 24h/2h
// reminder mark that haven't been reminded yet, creates an in-app
// notification + pending outbound deliveries for them (actual WhatsApp/
// email sending happens later, out-of-band, in process-notifications), and
// stamps the appointment so the same reminder is never enqueued twice.
//
// Windowed on purpose (23h-24h and 1h50-2h rather than "any time under
// 24h/2h away"): a narrower, correctly-labeled window beats a wide one that
// could fire a "tomorrow" reminder for an appointment booked five hours out.
// See docs/NOTIFICATIONS.md for the tradeoff this implies for cron cadence.
import { createClient } from "npm:@supabase/supabase-js@2";

type ReminderKind = "24h" | "2h";

const WINDOWS: Record<ReminderKind, { minHours: number; maxHours: number }> = {
  "24h": { minHours: 23, maxHours: 24 },
  "2h": { minHours: 1 + 50 / 60, maxHours: 2 },
};

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

  const now = new Date();
  const summary = { "24h": 0, "2h": 0 };

  for (const kind of ["24h", "2h"] as ReminderKind[]) {
    const { minHours, maxHours } = WINDOWS[kind];
    const windowStart = new Date(now.getTime() + minHours * 3_600_000).toISOString();
    const windowEnd = new Date(now.getTime() + maxHours * 3_600_000).toISOString();
    const sentColumn = kind === "24h" ? "reminder_24h_sent_at" : "reminder_2h_sent_at";
    const eventType = kind === "24h" ? "appointment.reminder_24h" : "appointment.reminder_2h";
    const settingsColumn = kind === "24h" ? "notify_reminder_24h" : "notify_reminder_2h";

    const { data: appointments } = await supabase
      .from("appointments")
      .select("id, business_id, customer_id, professional_id, service_id, starts_at")
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", windowStart)
      .lte("starts_at", windowEnd)
      .is(sentColumn, null);

    for (const appt of appointments ?? []) {
      try {
        await enqueueReminder(supabase, appt, eventType, settingsColumn, sentColumn);
        summary[kind] += 1;
      } catch (err) {
        // One appointment's failure (missing related row, transient DB
        // error) must never stop the rest of the sweep. Never log
        // customer/business names -- only ids and the error message.
        console.error(JSON.stringify({
          level: "error",
          event: "appointment_reminder.enqueue_failed",
          appointment_id: appt.id,
          business_id: appt.business_id,
          kind,
          error_message: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }

  return Response.json(summary);
});

async function enqueueReminder(
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  appt: {
    id: string;
    business_id: string;
    customer_id: string;
    professional_id: string;
    service_id: string;
    starts_at: string;
  },
  eventType: string,
  settingsColumn: "notify_reminder_24h" | "notify_reminder_2h",
  sentColumn: "reminder_24h_sent_at" | "reminder_2h_sent_at",
) {
  const [{ data: business }, { data: settings }, { data: customer }, { data: service }, { data: professional }, { data: owners }] =
    await Promise.all([
      supabase.from("businesses").select("*").eq("id", appt.business_id).maybeSingle(),
      supabase.from("business_settings").select("*").eq("business_id", appt.business_id).maybeSingle(),
      supabase.from("customers").select("*").eq("id", appt.customer_id).maybeSingle(),
      supabase.from("services").select("*").eq("id", appt.service_id).maybeSingle(),
      supabase.from("professionals").select("*").eq("id", appt.professional_id).maybeSingle(),
      supabase.from("business_members").select("user_id").eq("business_id", appt.business_id).eq("role", "owner"),
    ]);

  // Always stamp the appointment first: even if nothing downstream fires
  // (e.g. the owner has every channel disabled), this reminder must never
  // be re-evaluated on the next sweep.
  await supabase.from("appointments").update({ [sentColumn]: new Date().toISOString() }).eq("id", appt.id);

  if (!business || !customer || !service) return;

  const timezone = business.timezone ?? "America/Sao_Paulo";
  const startsAt = new Date(appt.starts_at);
  const dateLabel = startsAt.toLocaleDateString("pt-BR", { timeZone: timezone });
  const timeLabel = startsAt.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload = {
    customer_name: customer.name ?? "Cliente",
    service_name: service.name ?? "",
    professional_name: professional?.name ?? "",
    date_label: dateLabel,
    time_label: timeLabel,
    business_name: business.name ?? "",
  };

  const title = eventType === "appointment.reminder_24h" ? "Lembrete: agendamento amanhã" : "Lembrete: agendamento em 2 horas";
  const body = `${payload.customer_name} — ${payload.service_name} em ${dateLabel} às ${timeLabel}`;

  for (const owner of owners ?? []) {
    const { data: notification } = await supabase
      .from("notifications")
      .insert({
        business_id: appt.business_id,
        recipient_user_id: owner.user_id,
        appointment_id: appt.id,
        type: eventType,
        title,
        body,
      })
      .select("id")
      .single();

    if (!settings?.[settingsColumn]) continue;

    if (settings.notify_email_enabled && settings.notify_email_address) {
      await supabase.from("notification_deliveries").insert({
        business_id: appt.business_id,
        appointment_id: appt.id,
        notification_id: notification?.id ?? null,
        channel: "email",
        event_type: eventType,
        recipient: settings.notify_email_address,
        payload,
      });
    }

    if (settings.whatsapp_enabled && settings.whatsapp_phone) {
      await supabase.from("notification_deliveries").insert({
        business_id: appt.business_id,
        appointment_id: appt.id,
        notification_id: notification?.id ?? null,
        channel: "whatsapp",
        event_type: eventType,
        recipient: settings.whatsapp_phone,
        payload,
      });
    }
  }
}
