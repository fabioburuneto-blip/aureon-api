import Link from "next/link";
import { updateAppointmentStatus } from "./actions";
import { StatusBadge } from "./status-badge";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { formatDateTime, formatPriceCents } from "@/lib/format";
import type { AppointmentStatus } from "@/types/database";

type AppointmentRowData = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer: { name: string; phone: string | null } | null;
  professional: { name: string } | null;
  service: { name: string; price_cents: number } | null;
};

const actionsByStatus: Record<
  AppointmentStatus,
  { status: AppointmentStatus; label: string; danger?: boolean }[]
> = {
  pending: [
    { status: "confirmed", label: "Confirmar" },
    { status: "cancelled", label: "Cancelar", danger: true },
  ],
  confirmed: [
    { status: "completed", label: "Concluir" },
    { status: "no_show", label: "Não compareceu", danger: true },
    { status: "cancelled", label: "Cancelar", danger: true },
  ],
  cancelled: [],
  completed: [],
  no_show: [],
};

export function AppointmentRow({
  appointment,
  timezone,
}: {
  appointment: AppointmentRowData;
  timezone: string;
}) {
  const actions = actionsByStatus[appointment.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4">
      <Link
        href={`/dashboard/appointments/${appointment.id}`}
        className="flex flex-1 items-center gap-4 rounded-lg -mx-2 px-2 py-1 hover:bg-zinc-50"
      >
        <div className="text-sm font-medium text-zinc-900">
          {formatDateTime(appointment.starts_at, timezone)}
        </div>
        <div>
          <p className="font-medium text-zinc-900">
            {appointment.customer?.name ?? "Cliente"}
          </p>
          <p className="text-sm text-zinc-500">
            {appointment.service?.name} · {appointment.professional?.name}
            {appointment.customer?.phone
              ? ` · ${appointment.customer.phone}`
              : ""}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">
          {formatPriceCents(appointment.service?.price_cents ?? 0)}
        </span>
        <StatusBadge status={appointment.status} />
        {actions.map((action) => (
          <form key={action.status} action={updateAppointmentStatus}>
            <input type="hidden" name="id" value={appointment.id} />
            <input type="hidden" name="status" value={action.status} />
            {action.danger ? (
              <ConfirmSubmitButton
                confirmMessage={`${action.label} este agendamento?`}
              >
                {action.label}
              </ConfirmSubmitButton>
            ) : (
              <button
                type="submit"
                className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
              >
                {action.label}
              </button>
            )}
          </form>
        ))}
      </div>
    </li>
  );
}
