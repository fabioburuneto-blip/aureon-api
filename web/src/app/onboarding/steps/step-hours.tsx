"use client";

import { useActionState } from "react";
import { saveOnboardingHours } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, FieldError } from "@/components/ui/input";
import { WEEKDAY_LABELS } from "@/lib/format";
import type { Database } from "@/types/database";

type Business = Pick<Database["public"]["Tables"]["businesses"]["Row"], "id">;
type BusinessHour = Database["public"]["Tables"]["business_hours"]["Row"];

export function StepHours({
  hours,
}: {
  business: Business;
  hours: BusinessHour[];
}) {
  const [state, formAction, pending] = useActionState(
    saveOnboardingHours,
    undefined,
  );
  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Horário de funcionamento</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Defina quando sua empresa está aberta. Domingo já vem marcado como
        fechado -- ajuste se for diferente.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        {WEEKDAY_LABELS.map((label, day) => {
          const hour = hoursByDay.get(day);
          return (
            <div
              key={day}
              className="flex flex-wrap items-center gap-3 border-b border-zinc-100 pb-3 last:border-0"
            >
              <span className="w-32 text-sm font-medium text-zinc-700">{label}</span>
              <label className="flex items-center gap-1.5 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  name={`closed-${day}`}
                  defaultChecked={hour?.is_closed ?? day === 0}
                />
                Fechado
              </label>
              <Input
                type="time"
                name={`start-${day}`}
                defaultValue={hour?.start_time?.slice(0, 5) ?? "09:00"}
                className="w-32"
              />
              <span className="text-sm text-zinc-400">até</span>
              <Input
                type="time"
                name={`end-${day}`}
                defaultValue={hour?.end_time?.slice(0, 5) ?? "18:00"}
                className="w-32"
              />
            </div>
          );
        })}

        <FieldError message={state?.error} />

        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending ? "Salvando..." : "Continuar"}
        </Button>
      </form>
    </div>
  );
}
