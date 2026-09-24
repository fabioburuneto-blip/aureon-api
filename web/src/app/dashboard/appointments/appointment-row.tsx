import { updateAppointmentStatus } from "./actions";
import { StatusBadge } from "./status-badge";
import { formatTime, formatPriceCents } from "@/lib/format";
import type { AppointmentStatus } from "@/types/database";

type AppointmentRowData = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customers: { name: string; phone: string | null } | null;
  professionals: { name: string } | null;
  services: { name: string; price_cents: number } | null;
};

const actionsByStatus: Record<
  AppointmentStatus,
  { status: AppointmentStatus; label: string; variant: "confirm" | "danger" }[]
> = {
  pending: [
    { status: "confirmed", label: "Confirmar", variant: "confirm" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  confirmed: [
    { status: "completed", label: "Concluir", variant: "confirm" },
    { status: "no_show", label: "Não compareceu", variant: "danger" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
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
      <div className="flex items-center gap-4">
        <div className="text-sm font-medium text-zinc-900">
          {formatTime(appointment.starts_at, timezone)}–
          {formatTime(appointment.ends_at, timezone)}
        </div>
        <div>
          <p className="font-medium text-zinc-900">
            {appointment.customers?.name ?? "Cliente"}
          </p>
          <p className="text-sm text-zinc-500">
            {appointment.services?.name} · {appointment.professionals?.name}
            {appointment.customers?.phone
              ? ` · ${appointment.customers.phone}`
              : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">
          {formatPriceCents(appointment.services?.price_cents ?? 0)}
        </span>
        <StatusBadge status={appointment.status} />
        {actions.map((action) => (
          <form key={action.status} action={updateAppointmentStatus}>
            <input type="hidden" name="id" value={appointment.id} />
            <input type="hidden" name="status" value={action.status} />
            <button
              type="submit"
              className={
                action.variant === "danger"
                  ? "text-sm font-medium text-red-600 hover:text-red-700"
                  : "text-sm font-medium text-emerald-600 hover:text-emerald-700"
              }
            >
              {action.label}
            </button>
          </form>
        ))}
      </div>
    </li>
  );
}
