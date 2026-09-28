"use client";

import { useActionState } from "react";
import { updateThemeColors, type PersonalizationFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label, FieldError } from "@/components/ui/input";
import type { Database } from "@/types/database";

type Theme = Pick<
  Database["public"]["Tables"]["themes"]["Row"],
  "primary_color" | "secondary_color"
>;

export function ColorsForm({ theme }: { theme: Theme }) {
  const [state, formAction, pending] = useActionState<
    PersonalizationFormState,
    FormData
  >(updateThemeColors, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="primary_color">Cor primária</Label>
          <input
            type="color"
            name="primary_color"
            id="primary_color"
            defaultValue={theme.primary_color}
            className="h-10 w-14 rounded border border-zinc-300"
          />
        </div>
        <div>
          <Label htmlFor="secondary_color">Cor secundária</Label>
          <input
            type="color"
            name="secondary_color"
            id="secondary_color"
            defaultValue={theme.secondary_color}
            className="h-10 w-14 rounded border border-zinc-300"
          />
        </div>
      </div>

      <FieldError message={state?.error} />
      {state?.success && <p className="text-sm text-emerald-600">Cores salvas.</p>}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar cores"}
      </Button>
    </form>
  );
}
