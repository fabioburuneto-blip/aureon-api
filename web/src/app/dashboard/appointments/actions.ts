"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";

const statusSchema = z.enum([
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

function revalidateAppointmentPaths(id: string) {
  revalidatePath("/dashboard/appointments");
  revalidatePath(`/dashboard/appointments/${id}`);
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard");
}

export async function updateAppointmentStatus(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const status = statusSchema.parse(formData.get("status"));

  const { supabase, business } = await getCurrentBusiness();

  await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .eq("business_id", business.id);

  revalidateAppointmentPaths(id);
}

const rescheduleSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Informe um horário válido"),
});

export type RescheduleFormState =
  | { error?: string; success?: boolean }
  | undefined;

export async function rescheduleAppointment(
  _prevState: RescheduleFormState,
  formData: FormData,
): Promise<RescheduleFormState> {
  const parsed = rescheduleSchema.safeParse({
    id: formData.get("id"),
    date: formData.get("date"),
    time: formData.get("time"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();
  const { id, date, time } = parsed.data;

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, service_id")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!appointment) {
    return { error: "Agendamento não encontrado." };
  }

  const { data: service } = await supabase
    .from("services")
    .select("duration_minutes")
    .eq("id", appointment.service_id)
    .maybeSingle();

  const durationMinutes = service?.duration_minutes ?? 30;
  const startsAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Data ou horário inválido." };
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const { error } = await supabase
    .from("appointments")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) {
    if (error.code === "23P01") {
      return {
        error:
          "Esse horário conflita com outro agendamento deste profissional.",
      };
    }
    return { error: "Não foi possível reagendar." };
  }

  revalidateAppointmentPaths(id);
  return { success: true };
}
