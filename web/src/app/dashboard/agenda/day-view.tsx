import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "../appointments/status-badge";
import { formatTime, formatPriceCents } from "@/lib/format";
import type { AppointmentWithRelations } from "@/lib/appointments-data";

export function DayView({
  appointments,
  timezone,
}: {
  appointments: AppointmentWithRelations[];
  timezone: string;
}) {
  return (
    <Card>
      {appointments.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhum agendamento neste dia. Compartilhe sua página pública para
          receber os primeiros agendamentos.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <Link
                href={`/dashboard/appointments/${appointment.id}`}
                className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-4 hover:bg-zinc-50"
              >
                <div className="flex items-center gap-4">
                  <div className="text-sm font-medium text-zinc-900">
                    {formatTime(appointment.starts_at, timezone)}–
                    {formatTime(appointment.ends_at, timezone)}
                  </div>
                  <div>
                    <p className="font-medium text-zinc-900">
                      {appointment.customer?.name ?? "Cliente"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {appointment.service?.name} ·{" "}
                      {appointment.professional?.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500">
                    {formatPriceCents(appointment.service?.price_cents ?? 0)}
                  </span>
                  <StatusBadge status={appointment.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
