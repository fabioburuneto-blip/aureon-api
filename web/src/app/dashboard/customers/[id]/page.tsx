import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentBusiness } from "@/lib/auth";
import { fetchAppointmentsWithRelations } from "@/lib/appointments-data";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "../../appointments/status-badge";
import { formatDateTime, formatPriceCents } from "@/lib/format";

export default async function CustomerDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const { supabase, business } = await getCurrentBusiness();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!customer) {
    notFound();
  }

  const history = await fetchAppointmentsWithRelations(supabase, business.id, {
    customerId: customer.id,
    ascending: false,
  });

  const completedCount = history.filter((a) => a.status === "completed").length;
  const upcoming = history.filter(
    (a) =>
      (a.status === "pending" || a.status === "confirmed") &&
      new Date(a.starts_at).getTime() > new Date().getTime(),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard/customers"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Voltar para clientes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          {customer.name}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-zinc-500">Contato</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {customer.phone ?? "Telefone não informado"}
          </p>
          <p className="text-sm text-zinc-500">
            {customer.email ?? "Email não informado"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Atendimentos concluídos</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">
            {completedCount}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Próximos agendamentos</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">
            {upcoming.length}
          </p>
        </Card>
      </div>

      {customer.notes && (
        <Card>
          <h2 className="mb-1 font-medium text-zinc-900">Observações</h2>
          <p className="text-sm text-zinc-600">{customer.notes}</p>
        </Card>
      )}

      <Card>
        <h2 className="font-medium text-zinc-900">Histórico completo</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Este cliente ainda não tem agendamentos.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {history.map((appointment) => (
              <li key={appointment.id}>
                <Link
                  href={`/dashboard/appointments/${appointment.id}`}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-4 hover:bg-zinc-50"
                >
                  <div>
                    <p className="font-medium text-zinc-900">
                      {formatDateTime(appointment.starts_at, business.timezone)}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {appointment.service?.name} ·{" "}
                      {appointment.professional?.name}
                    </p>
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
    </div>
  );
}
