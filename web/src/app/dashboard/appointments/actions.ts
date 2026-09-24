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

export async function updateAppointmentStatus(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const status = statusSchema.parse(formData.get("status"));

  const { supabase, business } = await getCurrentBusiness();

  await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard");
}
