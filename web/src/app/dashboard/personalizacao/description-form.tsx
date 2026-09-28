"use client";

import { useActionState } from "react";
import { updateDescription, type DescriptionFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label, Textarea, FieldError } from "@/components/ui/input";

export function DescriptionForm({ description }: { description: string | null }) {
  const [state, formAction, pending] = useActionState<
    DescriptionFormState,
    FormData
  >(updateDescription, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="description">Descrição da empresa</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={description ?? ""}
          placeholder="Conte um pouco sobre o seu negócio..."
        />
      </div>

      <FieldError message={state?.error} />
      {state?.success && <p className="text-sm text-emerald-600">Descrição salva.</p>}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar descrição"}
      </Button>
    </form>
  );
}
