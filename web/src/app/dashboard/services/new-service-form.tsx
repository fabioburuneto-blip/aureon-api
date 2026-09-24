"use client";

import { useActionState, useEffect, useRef } from "react";
import { createService, type ServiceFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";

export function NewServiceForm() {
  const [state, formAction, pending] = useActionState<
    ServiceFormState,
    FormData
  >(createService, undefined);
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
          <Label htmlFor="new-name">Nome do serviço</Label>
          <Input
            id="new-name"
            name="name"
            placeholder="Corte masculino"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="new-duration">Duração (min)</Label>
            <Input
              id="new-duration"
              name="duration_minutes"
              type="number"
              min={5}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-price">Preço (R$)</Label>
            <Input
              id="new-price"
              name="price"
              type="number"
              min={0}
              step="0.01"
              required
            />
          </div>
        </div>
      </div>
      <div>
        <Label htmlFor="new-description">Descrição (opcional)</Label>
        <Textarea id="new-description" name="description" rows={2} />
      </div>

      <FieldError message={state?.error} />

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adicionando..." : "Adicionar serviço"}
      </Button>
    </form>
  );
}
