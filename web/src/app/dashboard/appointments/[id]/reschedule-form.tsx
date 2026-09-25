"use client";

import { useActionState } from "react";
import {
  rescheduleAppointment,
  type RescheduleFormState,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export function RescheduleForm({
  appointmentId,
  defaultDate,
  defaultTime,
}: {
  appointmentId: string;
  defaultDate: string;
  defaultTime: string;
}) {
  const [state, formAction, pending] = useActionState<
    RescheduleFormState,
    FormData
  >(rescheduleAppointment, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={appointmentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="reschedule-date">Nova data</Label>
          <Input
            id="reschedule-date"
            name="date"
            type="date"
            defaultValue={defaultDate}
            required
          />
        </div>
        <div>
          <Label htmlFor="reschedule-time">Novo horário</Label>
          <Input
            id="reschedule-time"
            name="time"
            type="time"
            defaultValue={defaultTime}
            required
          />
        </div>
      </div>

      <FieldError message={state?.error} />
      {state?.success && (
        <p className="text-sm font-medium text-emerald-600">
          Agendamento reagendado com sucesso.
        </p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Reagendando..." : "Reagendar"}
      </Button>
    </form>
  );
}
