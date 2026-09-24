"use client";

import { useActionState } from "react";
import { updateBusinessSettings, type SettingsFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import type { Database } from "@/types/database";

type Business = Database["public"]["Tables"]["businesses"]["Row"];

export function SettingsForm({ business }: { business: Business }) {
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(updateBusinessSettings, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name">Nome da empresa</Label>
        <Input id="name" name="name" defaultValue={business.name} required />
      </div>
      <div>
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={business.description ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" name="phone" defaultValue={business.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="email">Email de contato</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={business.email ?? ""}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="timezone">Fuso horário</Label>
        <Input
          id="timezone"
          name="timezone"
          defaultValue={business.timezone}
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="is_published"
          defaultChecked={business.is_published}
        />
        Página pública visível para clientes
      </label>

      <FieldError message={state?.error} />
      {state?.success && (
        <p className="text-sm text-emerald-600">Configurações salvas.</p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar configurações"}
      </Button>
    </form>
  );
}
