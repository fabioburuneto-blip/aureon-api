"use client";

import { useActionState, useState } from "react";
import {
  updateService,
  deleteService,
  moveService,
  type ServiceFormState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { formatPriceCents } from "@/lib/format";
import type { Database } from "@/types/database";

type Service = Database["public"]["Tables"]["services"]["Row"];

export function ServiceRow({
  service,
  isFirst,
  isLast,
}: {
  service: Service;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    ServiceFormState,
    FormData
  >(updateService, undefined);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <form action={moveService}>
              <input type="hidden" name="id" value={service.id} />
              <input type="hidden" name="direction" value="up" />
              <button
                type="submit"
                disabled={isFirst}
                aria-label="Mover para cima"
                title="Mover para cima"
                className="flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ▲
              </button>
            </form>
            <form action={moveService}>
              <input type="hidden" name="id" value={service.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                disabled={isLast}
                aria-label="Mover para baixo"
                title="Mover para baixo"
                className="flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ▼
              </button>
            </form>
          </div>
          <div>
            <p className="font-medium text-zinc-900">
              {service.name}
              {!service.is_active && (
                <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                  inativo
                </span>
              )}
            </p>
            <p className="text-sm text-zinc-500">
              {service.duration_minutes} min ·{" "}
              {formatPriceCents(service.price_cents)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Editar
          </button>
          <form action={deleteService}>
            <input type="hidden" name="id" value={service.id} />
            <ConfirmSubmitButton
              confirmMessage={`Excluir o serviço "${service.name}"? Essa ação não pode ser desfeita.`}
            >
              Excluir
            </ConfirmSubmitButton>
          </form>
        </div>
      </li>
    );
  }

  return (
    <li className="py-4">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={service.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`name-${service.id}`}>Nome</Label>
            <Input
              id={`name-${service.id}`}
              name="name"
              defaultValue={service.name}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`duration-${service.id}`}>Duração (min)</Label>
              <Input
                id={`duration-${service.id}`}
                name="duration_minutes"
                type="number"
                min={5}
                defaultValue={service.duration_minutes}
                required
              />
            </div>
            <div>
              <Label htmlFor={`price-${service.id}`}>Preço (R$)</Label>
              <Input
                id={`price-${service.id}`}
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={(service.price_cents / 100).toFixed(2)}
                required
              />
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor={`description-${service.id}`}>Descrição</Label>
          <Textarea
            id={`description-${service.id}`}
            name="description"
            rows={2}
            defaultValue={service.description ?? ""}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={service.is_active}
          />
          Serviço ativo (visível na página pública)
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
