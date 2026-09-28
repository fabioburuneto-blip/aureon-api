import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingWizard } from "./onboarding-wizard";
import type { Database } from "@/types/database";

type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  | "id"
  | "name"
  | "slug"
  | "segment"
  | "description"
  | "whatsapp"
  | "instagram"
  | "logo_url"
  | "cover_url"
  | "is_published"
  | "onboarding_step"
>;
type Service = Database["public"]["Tables"]["services"]["Row"];
type BusinessHour = Database["public"]["Tables"]["business_hours"]["Row"];
type Theme = Database["public"]["Tables"]["themes"]["Row"];

export default async function OnboardingPage(props: {
  searchParams: Promise<{ step?: string; published?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const searchParams = await props.searchParams;

  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    // No business yet -- step 1 (business creation) is the only thing to
    // show, regardless of what ?step= says.
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
        <OnboardingWizard step={1} business={null} services={[]} hours={[]} theme={null} />
      </div>
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, segment, description, whatsapp, instagram, logo_url, cover_url, is_published, onboarding_step",
    )
    .eq("id", membership.business_id)
    .returns<Business[]>()
    .single();

  if (!business) {
    redirect("/onboarding");
  }

  if (business.is_published) {
    // Wizard already completed in an earlier visit -- publishing is the
    // last step, so a published business has nothing left to resume.
    redirect("/dashboard");
  }

  const requestedStep = Number(searchParams.step ?? business.onboarding_step);
  // Never further than what's actually been reached (no skipping ahead by
  // editing the URL), but always free to go back and review an earlier
  // step -- onboarding_step only ever tracks the furthest point reached.
  const step = Math.min(
    Math.max(1, Number.isFinite(requestedStep) ? requestedStep : business.onboarding_step),
    business.onboarding_step,
  );

  const [{ data: services }, { data: hours }, { data: theme }] =
    await Promise.all([
      supabase
        .from("services")
        .select("*")
        .eq("business_id", business.id)
        .order("position", { ascending: true }),
      supabase
        .from("business_hours")
        .select("*")
        .eq("business_id", business.id)
        .order("day_of_week", { ascending: true }),
      supabase
        .from("themes")
        .select("*")
        .eq("business_id", business.id)
        .maybeSingle(),
    ]);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <OnboardingWizard
        step={step}
        business={business}
        services={(services ?? []) as Service[]}
        hours={(hours ?? []) as BusinessHour[]}
        theme={theme as Theme | null}
        justPublished={searchParams.published === "1"}
      />
    </div>
  );
}
