"use client";

import { useActionState } from "react";
import { updateTheme, type CustomizationFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label, Select, FieldError } from "@/components/ui/input";
import type { Database } from "@/types/database";

type Theme = Database["public"]["Tables"]["themes"]["Row"];

export function ThemeForm({ theme }: { theme: Theme }) {
  const [state, formAction, pending] = useActionState<
    CustomizationFormState,
    FormData
  >(updateTheme, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="primary_color">Cor primária</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              name="primary_color"
              defaultValue={theme.primary_color}
              className="h-10 w-14 rounded border border-zinc-300"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="secondary_color">Cor secundária</Label>
          <input
            type="color"
            name="secondary_color"
            defaultValue={theme.secondary_color}
            className="h-10 w-14 rounded border border-zinc-300"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="layout">Layout da página pública</Label>
        <Select id="layout" name="layout" defaultValue={theme.layout}>
          <option value="classic">Clássico</option>
          <option value="minimal">Minimalista</option>
        </Select>
      </div>

      <FieldError message={state?.error} />
      {state?.success && (
        <p className="text-sm text-emerald-600">Personalização salva.</p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar personalização"}
      </Button>
    </form>
  );
}
