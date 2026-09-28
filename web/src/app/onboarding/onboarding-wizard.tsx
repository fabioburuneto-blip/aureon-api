"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { StepBusiness } from "./steps/step-business";
import { StepServices } from "./steps/step-services";
import { StepHours } from "./steps/step-hours";
import { StepAppearance } from "./steps/step-appearance";
import { StepPublish } from "./steps/step-publish";
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

const STEP_LABELS = ["Negócio", "Serviços", "Horários", "Aparência", "Publicar"];

export function OnboardingWizard({
  step,
  business,
  services,
  hours,
  theme,
  justPublished = false,
}: {
  step: number;
  business: Business | null;
  services: Service[];
  hours: BusinessHour[];
  theme: Theme | null;
  justPublished?: boolean;
}) {
  return (
    <Card className="w-full max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const reached = business ? stepNumber <= business.onboarding_step : stepNumber === 1;
          const active = stepNumber === step;
          return (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                  active
                    ? "bg-zinc-900 text-white"
                    : reached
                      ? "bg-zinc-200 text-zinc-700"
                      : "bg-zinc-100 text-zinc-400",
                )}
              >
                {stepNumber}
              </div>
              <span
                className={cn(
                  "hidden text-center text-xs sm:block",
                  active ? "font-medium text-zinc-900" : "text-zinc-400",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {step === 1 && <StepBusiness />}
      {step === 2 && business && <StepServices business={business} services={services} />}
      {step === 3 && business && <StepHours business={business} hours={hours} />}
      {step === 4 && business && <StepAppearance business={business} theme={theme} />}
      {step === 5 && business && (
        <StepPublish business={business} justPublished={justPublished} />
      )}
    </Card>
  );
}
