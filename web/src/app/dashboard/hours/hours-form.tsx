"use client";

import { useActionState } from "react";
import { saveBusinessHours, type HoursFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, FieldError } from "@/components/ui/input";
import { WEEKDAY_LABELS } from "@/lib/format";
import type { Database } from "@/types/database";

type BusinessHour = Database["public"]["Tables"]["business_hours"]["Row"];

export function HoursForm({
  hoursByDay,
}: {
  hoursByDay: Map<number, BusinessHour>;
}) {
  const [state, formAction, pending] = useActionState<HoursFormState, FormData>(
    saveBusinessHours,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {WEEKDAY_LABELS.map((label, day) => {
        const hour = hoursByDay.get(day);
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-3 border-b border-zinc-100 pb-3 last:border-0"
          >
            <span className="w-32 text-sm font-medium text-zinc-700">
              {label}
            </span>
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
      {state?.success && (
        <p className="text-sm text-emerald-600">Horários salvos.</p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar horários"}
      </Button>
    </form>
  );
}
