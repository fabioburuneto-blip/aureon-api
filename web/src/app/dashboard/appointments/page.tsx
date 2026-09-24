import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppointmentRow } from "./appointment-row";

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

export default async function AppointmentsPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await props.searchParams;
  const selectedDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toDateKey(new Date());

  const { supabase, business } = await getCurrentBusiness();

  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const dayEnd = new Date(`${selectedDate}T23:59:59.999`);

  const { data: appointmentRows } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, status, notes, customer_id, professional_id, service_id",
    )
    .eq("business_id", business.id)
    .gte("starts_at", dayStart.toISOString())
    .lte("starts_at", dayEnd.toISOString())
    .order("starts_at", { ascending: true });

  const rows = appointmentRows ?? [];
  const customerIds = [...new Set(rows.map((a) => a.customer_id))];
  const professionalIds = [...new Set(rows.map((a) => a.professional_id))];
  const serviceIds = [...new Set(rows.map((a) => a.service_id))];

  const [{ data: customers }, { data: professionals }, { data: services }] =
    await Promise.all([
      customerIds.length
        ? supabase
            .from("customers")
            .select("id, name, phone")
            .in("id", customerIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; phone: string | null }[],
          }),
      professionalIds.length
        ? supabase
            .from("professionals")
            .select("id, name")
            .in("id", professionalIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      serviceIds.length
        ? supabase
            .from("services")
            .select("id, name, price_cents")
            .in("id", serviceIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; price_cents: number }[],
          }),
    ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const professionalById = new Map((professionals ?? []).map((p) => [p.id, p]));
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  const appointments = rows.map((appointment) => ({
    ...appointment,
    customers: customerById.get(appointment.customer_id) ?? null,
    professionals: professionalById.get(appointment.professional_id) ?? null,
    services: serviceById.get(appointment.service_id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Agenda</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Gerencie os agendamentos do dia.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href={`/dashboard/appointments?date=${addDays(selectedDate, -1)}`}
        >
          <Button variant="secondary">Anterior</Button>
        </Link>
        <span className="text-sm font-medium text-zinc-700">
          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
        </span>
        <Link href={`/dashboard/appointments?date=${addDays(selectedDate, 1)}`}>
          <Button variant="secondary">Próximo</Button>
        </Link>
        {selectedDate !== toDateKey(new Date()) && (
          <Link
            href="/dashboard/appointments"
            className="text-sm text-zinc-500 hover:underline"
          >
            Voltar para hoje
          </Link>
        )}
      </div>

      <Card>
        {appointments.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum agendamento neste dia.</p>
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
