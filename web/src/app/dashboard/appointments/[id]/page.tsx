import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { formatDateTime, formatTime, formatPriceCents } from "@/lib/format";
import { localDateKeyFromISO, localTimeFromISO } from "@/lib/date-utils";
import { StatusBadge } from "../status-badge";
import { updateAppointmentStatus } from "../actions";
import { RescheduleForm } from "./reschedule-form";
import type { AppointmentStatus } from "@/types/database";

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

export default async function AppointmentDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const { supabase, business } = await getCurrentBusiness();

  const { data: row } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, status, notes, customer_id, professional_id, service_id",
    )
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!row) {
    notFound();
  }

  const [{ data: customer }, { data: professional }, { data: service }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("id", row.customer_id)
        .maybeSingle(),
      supabase
        .from("professionals")
        .select("id, name")
        .eq("id", row.professional_id)
        .maybeSingle(),
      supabase
        .from("services")
        .select("id, name, price_cents")
        .eq("id", row.service_id)
        .maybeSingle(),
    ]);

  const appointment = {
    id: row.id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    notes: row.notes,
    customer,
    professional,
    service,
  };

  const canReschedule =
    appointment.status === "pending" || appointment.status === "confirmed";
  const actions = actionsByStatus[appointment.status];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard/appointments"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Voltar para agendamentos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          Agendamento
        </h1>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-zinc-900">
              {formatDateTime(appointment.starts_at, business.timezone)}
            </p>
            <p className="text-sm text-zinc-500">
              até {formatTime(appointment.ends_at, business.timezone)}
            </p>
          </div>
          <StatusBadge status={appointment.status} />
        </div>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Cliente
            </dt>
            <dd className="mt-1 text-sm text-zinc-900">
              {appointment.customer ? (
                <Link
                  href={`/dashboard/customers/${appointment.customer.id}`}
                  className="font-medium underline"
                >
                  {appointment.customer.name}
                </Link>
              ) : (
                "Cliente"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Telefone
            </dt>
            <dd className="mt-1 text-sm text-zinc-900">
              {appointment.customer?.phone ?? "Não informado"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Serviço
            </dt>
            <dd className="mt-1 text-sm text-zinc-900">
              {appointment.service?.name ?? "—"}
              {appointment.service && (
                <span className="text-zinc-500">
                  {" "}
                  · {formatPriceCents(appointment.service.price_cents)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Profissional
            </dt>
            <dd className="mt-1 text-sm text-zinc-900">
              {appointment.professional?.name ?? "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Observações
            </dt>
            <dd className="mt-1 text-sm text-zinc-900">
              {appointment.notes || "Nenhuma observação."}
            </dd>
          </div>
        </dl>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-3 border-t border-zinc-100 pt-4">
            {actions.map((action) => (
              <form key={action.status} action={updateAppointmentStatus}>
                <input type="hidden" name="id" value={appointment.id} />
                <input type="hidden" name="status" value={action.status} />
                {action.danger ? (
                  <ConfirmSubmitButton
                    confirmMessage={`${action.label} este agendamento?`}
                    className="rounded-lg border border-red-200 px-4 py-2"
                  >
                    {action.label}
                  </ConfirmSubmitButton>
                ) : (
                  <button
                    type="submit"
                    className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    {action.label}
                  </button>
                )}
              </form>
            ))}
          </div>
        )}
      </Card>

      {canReschedule && (
        <Card>
          <h2 className="mb-3 font-medium text-zinc-900">Reagendar</h2>
          <RescheduleForm
            appointmentId={appointment.id}
            defaultDate={localDateKeyFromISO(
              appointment.starts_at,
              business.timezone,
            )}
            defaultTime={localTimeFromISO(
              appointment.starts_at,
              business.timezone,
            )}
          />
        </Card>
      )}
    </div>
  );
}
