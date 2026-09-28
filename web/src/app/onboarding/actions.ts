"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createBusinessSchema, serviceSchema } from "@/lib/validations";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth";
import { saveBusinessHours, type HoursFormState } from "@/app/dashboard/hours/actions";
import { logError } from "@/lib/logger";

export type OnboardingState =
  | { error?: string; businessId?: string }
  | undefined;

/** Step 1 -- creates the business (and, atomically, its membership,
 * settings, theme and trial subscription via create_business()) and
 * immediately marks step 2 as the resume point. This is the only step
 * that can't be re-run: once the business exists, later visits to
 * /onboarding render step 2+ instead of this form again. */
export async function createOnboardingBusiness(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = createBusinessSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    segment: formData.get("segment"),
    timezone: "America/Sao_Paulo",
    whatsapp: formData.get("whatsapp"),
    instagram: formData.get("instagram"),
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

  const { data, error } = await supabase.rpc("create_business", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_segment: parsed.data.segment,
    p_timezone: parsed.data.timezone,
    p_whatsapp: parsed.data.whatsapp || null,
    p_instagram: parsed.data.instagram || null,
  });

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Esse endereço já está em uso. Escolha outro." };
    }
    logError("onboarding.create_business_failed", { code: error?.code }, error);
    return { error: "Não foi possível criar sua empresa. Tente novamente." };
  }

  await supabase
    .from("businesses")
    .update({ onboarding_step: 2 })
    .eq("id", data.id);

  redirect("/onboarding?step=2");
}

/** Step 2 -- inserts every service the owner kept from the suggested list
 * (or added manually) in one call, then advances to step 3. An empty list
 * is allowed (the owner can add services later from the dashboard) --
 * this step is a convenience, not a hard requirement. */
const onboardingServicesSchema = z.array(
  serviceSchema.omit({ is_active: true }),
);

export type OnboardingServicesState = { error?: string } | undefined;

export async function saveOnboardingServices(
  _prevState: OnboardingServicesState,
  formData: FormData,
): Promise<OnboardingServicesState> {
  const raw = formData.get("services");
  let servicesInput: unknown;
  try {
    servicesInput = JSON.parse(typeof raw === "string" ? raw : "[]");
  } catch {
    return { error: "Dados de serviços inválidos." };
  }

  const parsed = onboardingServicesSchema.safeParse(servicesInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  if (parsed.data.length > 0) {
    const { error } = await supabase.from("services").insert(
      parsed.data.map((service) => ({
        business_id: business.id,
        name: service.name,
        description: service.description || null,
        duration_minutes: service.duration_minutes,
        price_cents: Math.round(service.price * 100),
        is_active: true,
      })),
    );

    if (error) {
      logError("onboarding.services_failed", { business_id: business.id, code: error.code }, error);
      return { error: "Não foi possível salvar os serviços." };
    }
  }

  await advanceStep(supabase, business.id, 3);
  redirect("/onboarding?step=3");
}

/** Step 3 -- reuses the dashboard's own saveBusinessHours() (same
 * validation, same upsert) instead of a second copy of that logic, then
 * advances to step 4 on success. */
export async function saveOnboardingHours(
  prevState: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const result = await saveBusinessHours(prevState, formData);
  if (result?.success) {
    const { supabase, business } = await getCurrentBusiness();
    await advanceStep(supabase, business.id, 4);
    redirect("/onboarding?step=4");
  }
  return result;
}

/** Step 4 -- only the description is unique to this step; logo/capa/tema
 * already have their own dedicated forms (ImageUploader, ThemeForm) that
 * this step embeds and reuses as-is. "Continuar" just advances -- nothing
 * here is required. */
const appearanceSchema = z.object({
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export type OnboardingAppearanceState = { error?: string } | undefined;

export async function saveOnboardingAppearance(
  _prevState: OnboardingAppearanceState,
  formData: FormData,
): Promise<OnboardingAppearanceState> {
  const parsed = appearanceSchema.safeParse({
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("businesses")
    .update({ description: parsed.data.description || null })
    .eq("id", business.id);

  if (error) {
    logError("onboarding.appearance_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar a descrição." };
  }

  await advanceStep(supabase, business.id, 5);
  redirect("/onboarding?step=5");
}

/** Step 5 -- publishes the business and lands on the "seu link está
 * pronto" screen. */
export async function publishOnboardingBusiness() {
  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("businesses")
    .update({ is_published: true, onboarding_step: 5 })
    .eq("id", business.id);

  if (error) {
    logError("onboarding.publish_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível publicar sua página." };
  }

  revalidatePath(`/${business.slug}`);
  redirect("/onboarding?step=5&published=1");
}

/** Lets the owner jump back to an earlier step to review/edit it without
 * losing the furthest step already reached (going back and re-advancing
 * never regresses onboarding_step). */
async function advanceStep(
  supabase: Awaited<ReturnType<typeof getCurrentBusiness>>["supabase"],
  businessId: string,
  step: number,
) {
  await supabase.rpc("greatest_onboarding_step", {
    p_business_id: businessId,
    p_step: step,
  });
}
