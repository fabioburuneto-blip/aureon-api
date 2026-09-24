"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness } from "@/lib/auth";
import { businessHoursSchema } from "@/lib/validations";

export type HoursFormState = { error?: string; success?: boolean } | undefined;

export async function saveBusinessHours(
  _prevState: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const { supabase, business } = await getCurrentBusiness();

  const rows = [];
  for (let day = 0; day <= 6; day++) {
    const isClosed = formData.get(`closed-${day}`) === "on";
    const parsed = businessHoursSchema.safeParse({
      day_of_week: day,
      start_time: formData.get(`start-${day}`) || "09:00",
      end_time: formData.get(`end-${day}`) || "18:00",
      is_closed: isClosed,
    });

    if (!parsed.success) {
      return { error: `Horário inválido em um dos dias da semana.` };
    }

    if (!isClosed && parsed.data.end_time <= parsed.data.start_time) {
      return { error: "O horário de término deve ser depois do início." };
    }

    rows.push({
      business_id: business.id,
      day_of_week: parsed.data.day_of_week,
      start_time: parsed.data.start_time,
      end_time: parsed.data.end_time,
      is_closed: parsed.data.is_closed,
    });
  }

  const { error } = await supabase
    .from("business_hours")
    .upsert(rows, { onConflict: "business_id,day_of_week" });

  if (error) {
    return { error: "Não foi possível salvar os horários." };
  }

  revalidatePath("/dashboard/hours");
  return { success: true };
}
