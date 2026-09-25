"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

export async function markNotificationRead(id: string) {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return;

  const { supabase, user } = await requireUser();

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .eq("recipient_user_id", user.id);

  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard", "layout");
}

export async function markAllNotificationsRead() {
  const { supabase, user } = await requireUser();

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", user.id)
    .is("read_at", null);

  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard", "layout");
}
