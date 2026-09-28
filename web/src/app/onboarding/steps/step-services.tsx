"use client";

import { useActionState, useState } from "react";
import { saveOnboardingServices } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SUGGESTED_SERVICES } from "@/lib/onboarding-suggestions";
import type { Database } from "@/types/database";

type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "id" | "segment"
>;
type Service = Database["public"]["Tables"]["services"]["Row"];

interface DraftService {
  name: string;
  duration_minutes: number;
  price: number;
}

export function StepServices({
  business,
  services,
}: {
  business: Business;
  services: Service[];
}) {
  const [state, formAction, pending] = useActionState(
    saveOnboardingServices,
    undefined,
  );
  const [drafts, setDrafts] = useState<DraftService[]>(() =>
    services.length > 0
      ? services.map((s) => ({
          name: s.name,
          duration_minutes: s.duration_minutes,
          price: s.price_cents / 100,
        }))
      : SUGGESTED_SERVICES[business.segment],
  );

  function updateDraft(index: number, patch: Partial<DraftService>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function removeDraft(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function addDraft() {
    setDrafts((prev) => [...prev, { name: "", duration_minutes: 30, price: 0 }]);
  }

  const validDrafts = drafts.filter((d) => d.name.trim().length >= 2);

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Seus serviços</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Já sugerimos alguns serviços comuns para o seu segmento. Edite,
        remova ou adicione o que fizer sentido -- você pode ajustar tudo
        depois também.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <input
          type="hidden"
          name="services"
          value={JSON.stringify(
            validDrafts.map((d) => ({
              name: d.name.trim(),
              duration_minutes: d.duration_minutes,
              price: d.price,
            })),
          )}
        />

        <div className="flex flex-col gap-3">
          {drafts.map((draft, index) => (
            <div
              key={index}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3"
            >
              <div className="min-w-[140px] flex-1">
                <Label htmlFor={`svc-name-${index}`}>Nome</Label>
                <Input
                  id={`svc-name-${index}`}
                  value={draft.name}
                  onChange={(e) => updateDraft(index, { name: e.target.value })}
                  placeholder="Corte"
                />
              </div>
              <div className="w-24">
                <Label htmlFor={`svc-dur-${index}`}>Duração (min)</Label>
                <Input
                  id={`svc-dur-${index}`}
                  type="number"
                  min={5}
                  max={600}
                  value={draft.duration_minutes}
                  onChange={(e) =>
                    updateDraft(index, { duration_minutes: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="w-28">
                <Label htmlFor={`svc-price-${index}`}>Preço (R$)</Label>
                <Input
                  id={`svc-price-${index}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.price}
                  onChange={(e) =>
                    updateDraft(index, { price: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => removeDraft(index)}
                className="mb-2 text-sm text-zinc-400 hover:text-red-600"
                aria-label="Remover serviço"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addDraft}
          className="self-start text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          + Adicionar serviço
        </button>

        <FieldError message={state?.error} />

        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending ? "Salvando..." : "Continuar"}
        </Button>
      </form>
    </div>
  );
}
