import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { fetchAppointmentsWithRelations } from "@/lib/appointments-data";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "./appointments/status-badge";
import { formatDateTime, formatTime, formatPriceCents } from "@/lib/format";
import { dayRangeISO, parseDateKey, todayKeyInTimeZone } from "@/lib/date-utils";

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export default async function DashboardOverviewPage() {
  const { supabase, business } = await getCurrentBusiness();

  const todayKey = todayKeyInTimeZone(business.timezone);
  const { fromISO: todayStart, toISO: todayEnd } = dayRangeISO(
    todayKey,
    business.timezone,
  );
  // parseDateKey()/.getDay() both operate in the same (server-local) frame
  // with no explicit timezone involved, so this round-trip can't roll over
  // to a different calendar day -- the timezone-sensitive part already
  // happened above, resolving todayKey correctly for the business.
  const todayWeekday = parseDateKey(todayKey).getDay();

  const [
    pendingCountRes,
    customersCountRes,
    servicesCountRes,
    upcoming,
    todayAppointments,
    { data: todayHours },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("status", "pending"),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id),
    supabase
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("is_active", true),
    fetchAppointmentsWithRelations(supabase, business.id, {
      fromISO: new Date().toISOString(),
      excludeStatuses: ["cancelled"],
      limit: 5,
    }),
    fetchAppointmentsWithRelations(supabase, business.id, {
      fromISO: todayStart,
      toISO: todayEnd,
    }),
    supabase
      .from("business_hours")
      .select("*")
      .eq("business_id", business.id)
      .eq("day_of_week", todayWeekday)
      .maybeSingle(),
  ]);

  const todayActive = todayAppointments.filter((a) => a.status !== "cancelled");
  const cancelledToday = todayAppointments.filter(
    (a) => a.status === "cancelled",
  ).length;

  let occupancyLabel = "Sem horário definido";
  if (todayHours?.is_closed) {
    occupancyLabel = "Fechado hoje";
  } else if (todayHours) {
    const openMinutes =
      parseTimeToMinutes(todayHours.end_time) -
      parseTimeToMinutes(todayHours.start_time);
    if (openMinutes > 0) {
      const bookedMinutes = todayActive.reduce(
        (sum, a) => sum + (a.service?.duration_minutes ?? 0),
        0,
      );
      occupancyLabel = `${Math.min(100, Math.round((bookedMinutes / openMinutes) * 100))}%`;
    }
  }

  const stats = [
    { label: "Agendamentos hoje", value: String(todayActive.length) },
    { label: "Pendentes de confirmação", value: String(pendingCountRes.count ?? 0) },
    { label: "Cancelamentos hoje", value: String(cancelledToday) },
    { label: "Clientes cadastrados", value: String(customersCountRes.count ?? 0) },
    { label: "Serviços ativos", value: String(servicesCountRes.count ?? 0) },
    { label: "Ocupação hoje", value: occupancyLabel },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Visão geral</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sua página pública:{" "}
          <Link
            href={`/${business.slug}`}
            target="_blank"
            className="font-medium underline"
          >
            seusite.com/{business.slug}
          </Link>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-sm text-zinc-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">
              {stat.value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-zinc-900">Agenda de hoje</h2>
            <Link
              href="/dashboard/agenda"
              className="text-sm text-zinc-500 hover:underline"
            >
              Ver agenda completa
            </Link>
          </div>
          {todayAppointments.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nenhum agendamento para hoje. Compartilhe o link da sua{" "}
              <Link href={`/${business.slug}`} target="_blank" className="underline">
                página pública
              </Link>{" "}
              para receber agendamentos.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {todayAppointments.map((appt) => (
                <li key={appt.id}>
                  <Link
                    href={`/dashboard/appointments/${appt.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 text-sm hover:bg-zinc-50"
                  >
                    <div>
                      <p className="font-medium text-zinc-900">
                        {formatTime(appt.starts_at, business.timezone)} ·{" "}
                        {appt.customer?.name ?? "Cliente"}
                      </p>
                      <p className="text-zinc-500">
                        {appt.service?.name} · {appt.professional?.name}
                      </p>
                    </div>
                    <StatusBadge status={appt.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-medium text-zinc-900">Próximos agendamentos</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Nenhum agendamento futuro ainda.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {upcoming.map((appt) => (
                <li key={appt.id}>
                  <Link
                    href={`/dashboard/appointments/${appt.id}`}
                    className="-mx-2 flex items-center justify-between py-3 text-sm hover:bg-zinc-50 rounded-lg px-2"
                  >
                    <div>
                      <p className="font-medium text-zinc-900">
                        {appt.customer?.name ?? "Cliente"} — {appt.service?.name}
                      </p>
                      <p className="text-zinc-500">
                        {formatDateTime(appt.starts_at, business.timezone)}
                      </p>
                    </div>
                    <span className="text-zinc-500">
                      {formatPriceCents(appt.service?.price_cents ?? 0)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
