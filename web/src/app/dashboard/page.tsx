import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatPriceCents } from "@/lib/format";

export default async function DashboardOverviewPage() {
  const { supabase, business } = await getCurrentBusiness();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [
    todayCountRes,
    pendingCountRes,
    customersCountRes,
    servicesCountRes,
    upcomingRes,
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("starts_at", todayStart.toISOString())
      .lte("starts_at", todayEnd.toISOString())
      .neq("status", "cancelled"),
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
    supabase
      .from("appointments")
      .select("id, starts_at, status, customer_id, service_id")
      .eq("business_id", business.id)
      .neq("status", "cancelled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(5),
  ]);

  const upcoming = upcomingRes.data ?? [];
  const customerIds = [...new Set(upcoming.map((a) => a.customer_id))];
  const serviceIds = [...new Set(upcoming.map((a) => a.service_id))];

  const [{ data: upcomingCustomers }, { data: upcomingServices }] =
    await Promise.all([
      customerIds.length
        ? supabase.from("customers").select("id, name").in("id", customerIds)
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

  const customerById = new Map((upcomingCustomers ?? []).map((c) => [c.id, c]));
  const serviceById = new Map((upcomingServices ?? []).map((s) => [s.id, s]));

  const stats = [
    { label: "Agendamentos hoje", value: todayCountRes.count ?? 0 },
    { label: "Pendentes de confirmação", value: pendingCountRes.count ?? 0 },
    { label: "Clientes cadastrados", value: customersCountRes.count ?? 0 },
    { label: "Serviços ativos", value: servicesCountRes.count ?? 0 },
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-sm text-zinc-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">
              {stat.value}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="font-medium text-zinc-900">Próximos agendamentos</h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum agendamento futuro ainda.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {upcoming.map((appt) => {
              const customer = customerById.get(appt.customer_id);
              const service = serviceById.get(appt.service_id);
              return (
                <li
                  key={appt.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-zinc-900">
                      {customer?.name ?? "Cliente"} — {service?.name}
                    </p>
                    <p className="text-zinc-500">
                      {formatDateTime(appt.starts_at, business.timezone)}
                    </p>
                  </div>
                  <span className="text-zinc-500">
                    {formatPriceCents(service?.price_cents ?? 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
