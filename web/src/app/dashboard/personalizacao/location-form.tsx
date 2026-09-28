"use client";

import { useActionState } from "react";
import { updateBusinessLocation, type PersonalizationFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export function LocationForm({
  address,
  city,
}: {
  address: string | null;
  city: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    PersonalizationFormState,
    FormData
  >(updateBusinessLocation, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="address">Endereço</Label>
          <Input
            id="address"
            name="address"
            defaultValue={address ?? ""}
            placeholder="Rua Exemplo, 123"
          />
        </div>
        <div>
          <Label htmlFor="city">Cidade</Label>
          <Input
            id="city"
            name="city"
            defaultValue={city ?? ""}
            placeholder="São Paulo, SP"
          />
        </div>
      </div>

      <FieldError message={state?.error} />
      {state?.success && <p className="text-sm text-emerald-600">Localização salva.</p>}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar localização"}
      </Button>
    </form>
  );
}
