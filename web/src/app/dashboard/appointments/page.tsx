import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { fetchAppointmentsWithRelations } from "@/lib/appointments-data";
import { Card } from "@/components/ui/card";
import { AppointmentRow } from "./appointment-row";
import { AppointmentFilters } from "./filters-form";
import type { AppointmentStatus } from "@/types/database";

const VALID_STATUSES: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
];

export default async function AppointmentsPage(props: {
  searchParams: Promise<{
    status?: string;
    professional?: string;
    range?: string;
    q?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const status = VALID_STATUSES.includes(
    searchParams.status as AppointmentStatus,
  )
    ? (searchParams.status as AppointmentStatus)
    : undefined;
  const professionalId = searchParams.professional || undefined;
  const range =
    searchParams.range === "past" || searchParams.range === "all"
      ? searchParams.range
      : "upcoming";
  const q = searchParams.q?.trim() || undefined;

  const { supabase, business } = await getCurrentBusiness();
  const nowISO = new Date().toISOString();

  const [appointments, { data: professionals }] = await Promise.all([
    fetchAppointmentsWithRelations(supabase, business.id, {
      statuses: status ? [status] : undefined,
      professionalId,
      search: q,
      ascending: range !== "past",
      limit: range === "upcoming" ? undefined : 200,
      fromISO: range === "upcoming" ? nowISO : undefined,
      toISO: range === "past" ? nowISO : undefined,
    }),
    supabase
      .from("professionals")
      .select("*")
      .eq("business_id", business.id)
      .order("position", { ascending: true }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Agendamentos</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Veja, filtre e gerencie todos os agendamentos. Para uma visão de
          calendário, use a{" "}
          <Link href="/dashboard/agenda" className="underline">
            Agenda
          </Link>
          .
        </p>
      </div>

      <Card>
        <AppointmentFilters
          professionals={professionals ?? []}
          defaultValues={{
            status: status ?? "",
            professional: professionalId ?? "",
            range,
            q: q ?? "",
          }}
        />
      </Card>

      <Card>
        <h2 className="font-medium text-zinc-900">
          {appointments.length} agendamento
          {appointments.length === 1 ? "" : "s"}
        </h2>
        {appointments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum agendamento encontrado com esses filtros.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {appointments.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                timezone={business.timezone}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
