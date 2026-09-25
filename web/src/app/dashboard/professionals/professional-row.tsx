"use client";

import { useActionState, useState } from "react";
import {
  updateProfessional,
  deleteProfessional,
  type ProfessionalFormState,
} from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { ServiceCheckboxes } from "./service-checkboxes";
import type { Database } from "@/types/database";

type Professional = Database["public"]["Tables"]["professionals"]["Row"];
type Service = Database["public"]["Tables"]["services"]["Row"];

export function ProfessionalRow({
  professional,
  services,
  selectedServiceIds,
}: {
  professional: Professional;
  services: Service[];
  selectedServiceIds: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    ProfessionalFormState,
    FormData
  >(updateProfessional, undefined);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="font-medium text-zinc-900">
            {professional.name}
            {!professional.is_active && (
              <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                inativo
              </span>
            )}
          </p>
          {professional.bio && (
            <p className="text-sm text-zinc-500">{professional.bio}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/agenda?professional=${professional.id}`}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Ver agenda
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Editar
          </button>
          <form action={deleteProfessional}>
            <input type="hidden" name="id" value={professional.id} />
            <ConfirmSubmitButton
              confirmMessage={`Remover o profissional "${professional.name}"? Se ele já tiver agendamentos, será apenas desativado.`}
            >
              Remover
            </ConfirmSubmitButton>
          </form>
        </div>
      </li>
    );
  }

  return (
    <li className="py-4">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={professional.id} />
        <div>
          <Label htmlFor={`prof-name-${professional.id}`}>Nome</Label>
          <Input
            id={`prof-name-${professional.id}`}
            name="name"
            defaultValue={professional.name}
            required
          />
        </div>
        <div>
          <Label htmlFor={`prof-bio-${professional.id}`}>Bio</Label>
          <Textarea
            id={`prof-bio-${professional.id}`}
            name="bio"
            rows={2}
            defaultValue={professional.bio ?? ""}
          />
        </div>
        <div>
          <Label>Serviços que realiza</Label>
          <ServiceCheckboxes
            idPrefix={`prof-${professional.id}`}
            services={services}
            selectedIds={selectedServiceIds}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={professional.is_active}
          />
          Profissional ativo (visível na página pública)
        </label>

        <FieldError message={state?.error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditing(false)}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </li>
  );
}
