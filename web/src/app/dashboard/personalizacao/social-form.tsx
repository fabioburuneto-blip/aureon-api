"use client";

import { useActionState } from "react";
import { updateBusinessSocial, type PersonalizationFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export function SocialForm({
  whatsapp,
  instagram,
}: {
  whatsapp: string | null;
  instagram: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    PersonalizationFormState,
    FormData
  >(updateBusinessSocial, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            name="whatsapp"
            defaultValue={whatsapp ?? ""}
            placeholder="+55 11 99999-9999"
          />
        </div>
        <div>
          <Label htmlFor="instagram">Instagram</Label>
          <Input
            id="instagram"
            name="instagram"
            defaultValue={instagram ?? ""}
            placeholder="@seu.negocio"
          />
        </div>
      </div>

      <FieldError message={state?.error} />
      {state?.success && <p className="text-sm text-emerald-600">Redes sociais salvas.</p>}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar redes sociais"}
      </Button>
    </form>
  );
}
