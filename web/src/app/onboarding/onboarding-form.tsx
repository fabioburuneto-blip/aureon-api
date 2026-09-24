"use client";

import { useActionState, useState } from "react";
import { createBusiness } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { businessSegments, segmentLabels } from "@/lib/validations";
import { slugify } from "@/lib/slug";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    createBusiness,
    undefined,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  return (
    <Card className="w-full max-w-md">
      <h1 className="text-xl font-semibold text-zinc-900">Crie sua empresa</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Leva menos de um minuto. Você poderá ajustar tudo depois.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <div>
          <Label htmlFor="name">Nome da empresa</Label>
          <Input
            id="name"
            name="name"
            required
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Barbearia do Fábio"
          />
        </div>

        <div>
          <Label htmlFor="slug">Endereço público</Label>
          <div className="flex items-center gap-1 text-sm text-zinc-500">
            <span className="whitespace-nowrap">seusite.com/</span>
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="barbearia-do-fabio"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="segment">Segmento</Label>
          <Select id="segment" name="segment" required defaultValue="">
            <option value="" disabled>
              Selecione...
            </option>
            {businessSegments.map((segment) => (
              <option key={segment} value={segment}>
                {segmentLabels[segment]}
              </option>
            ))}
          </Select>
        </div>

        <FieldError message={state?.error} />

        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending ? "Criando..." : "Criar empresa"}
        </Button>
      </form>
    </Card>
  );
}
