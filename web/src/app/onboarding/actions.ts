"use server";

import { redirect } from "next/navigation";
import { createBusinessSchema } from "@/lib/validations";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string } | undefined;

export async function createBusiness(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = createBusinessSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    segment: formData.get("segment"),
    timezone: "America/Sao_Paulo",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("create_business", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_segment: parsed.data.segment,
    p_timezone: parsed.data.timezone,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Esse endereço já está em uso. Escolha outro." };
    }
    return { error: "Não foi possível criar sua empresa. Tente novamente." };
  }

  redirect("/dashboard/services?welcome=1");
}
