"use client";

import { useActionState } from "react";
import { saveOnboardingAppearance } from "../actions";
import { Button } from "@/components/ui/button";
import { Label, Textarea, FieldError } from "@/components/ui/input";
import { ImageUploader } from "@/app/dashboard/personalizacao/image-uploader";
import { ColorsForm } from "@/app/dashboard/personalizacao/colors-form";
import type { Database } from "@/types/database";

type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "id" | "description" | "logo_url" | "cover_url"
>;
type Theme = Database["public"]["Tables"]["themes"]["Row"];

export function StepAppearance({
  business,
  theme,
}: {
  business: Business;
  theme: Theme | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveOnboardingAppearance,
    undefined,
  );

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Aparência</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Tudo aqui é opcional e pode ser alterado depois em Personalização.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <ImageUploader
            businessId={business.id}
            kind="logo"
            currentUrl={business.logo_url}
            label="Logo"
          />
          <ImageUploader
            businessId={business.id}
            kind="cover"
            currentUrl={business.cover_url}
            label="Imagem de capa"
          />
        </div>

        {theme && <ColorsForm theme={theme} />}

        <form action={formAction} className="flex flex-col gap-4 border-t border-zinc-100 pt-4">
          <div>
            <Label htmlFor="description">Descrição da empresa</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={business.description ?? ""}
              placeholder="Conte um pouco sobre o seu negócio..."
            />
          </div>

          <FieldError message={state?.error} />

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Salvando..." : "Continuar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
