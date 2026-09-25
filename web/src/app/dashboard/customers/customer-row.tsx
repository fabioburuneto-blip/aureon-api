"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  updateCustomer,
  deleteCustomer,
  type CustomerFormState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import type { Database } from "@/types/database";

type Customer = Database["public"]["Tables"]["customers"]["Row"];
type CustomerStats = {
  completedCount: number;
  lastCompletedAt: string | null;
  upcomingCount: number;
};

export function CustomerRow({
  customer,
  stats,
  timezone,
}: {
  customer: Customer;
  stats: CustomerStats;
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    CustomerFormState,
    FormData
  >(updateCustomer, undefined);

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div>
          <Link
            href={`/dashboard/customers/${customer.id}`}
            className="font-medium text-zinc-900 hover:underline"
          >
            {customer.name}
          </Link>
          <p className="text-sm text-zinc-500">
            {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
              "Sem contato"}
          </p>
          {customer.notes && (
            <p className="mt-1 text-sm text-zinc-500">{customer.notes}</p>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            {stats.completedCount} atendimento
            {stats.completedCount === 1 ? "" : "s"}
            {stats.lastCompletedAt &&
              ` · último em ${formatDateTime(stats.lastCompletedAt, timezone)}`}
            {stats.upcomingCount > 0 &&
              ` · ${stats.upcomingCount} próximo${stats.upcomingCount === 1 ? "" : "s"} agendamento${stats.upcomingCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/customers/${customer.id}`}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Histórico
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Editar
          </button>
          <form action={deleteCustomer}>
            <input type="hidden" name="id" value={customer.id} />
            <ConfirmSubmitButton
              confirmMessage={`Excluir o cliente "${customer.name}"? Essa ação não pode ser desfeita.`}
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
        <input type="hidden" name="id" value={customer.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`c-name-${customer.id}`}>Nome</Label>
            <Input
              id={`c-name-${customer.id}`}
              name="name"
              defaultValue={customer.name}
              required
            />
          </div>
          <div>
            <Label htmlFor={`c-phone-${customer.id}`}>Telefone</Label>
            <Input
              id={`c-phone-${customer.id}`}
              name="phone"
              defaultValue={customer.phone ?? ""}
            />
          </div>
          <div>
            <Label htmlFor={`c-email-${customer.id}`}>Email</Label>
            <Input
              id={`c-email-${customer.id}`}
              name="email"
              defaultValue={customer.email ?? ""}
            />
          </div>
        </div>
        <div>
          <Label htmlFor={`c-notes-${customer.id}`}>Observações</Label>
          <Textarea
            id={`c-notes-${customer.id}`}
            name="notes"
            rows={2}
            defaultValue={customer.notes ?? ""}
          />
        </div>

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
