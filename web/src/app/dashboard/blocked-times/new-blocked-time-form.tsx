"use client";

import { useActionState, useEffect, useRef } from "react";
import { createBlockedTime, type BlockedTimeFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import type { Database } from "@/types/database";

type Professional = Database["public"]["Tables"]["professionals"]["Row"];

export function NewBlockedTimeForm({
  professionals,
}: {
  professionals: Professional[];
}) {
  const [state, formAction, pending] = useActionState<
    BlockedTimeFormState,
    FormData
  >(createBlockedTime, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="bt-start">Início</Label>
          <Input
            id="bt-start"
            name="starts_at"
            type="datetime-local"
            required
          />
        </div>
        <div>
          <Label htmlFor="bt-end">Término</Label>
          <Input id="bt-end" name="ends_at" type="datetime-local" required />
        </div>
      </div>
      <div>
        <Label htmlFor="bt-professional">Aplica-se a</Label>
        <Select id="bt-professional" name="professional_id" defaultValue="">
          <option value="">Toda a empresa</option>
          {professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="bt-reason">Motivo (opcional)</Label>
        <Input
          id="bt-reason"
          name="reason"
          placeholder="Férias, feriado, almoço..."
        />
      </div>

      <FieldError message={state?.error} />

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Adicionar bloqueio"}
      </Button>
    </form>
  );
}
