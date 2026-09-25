import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentStatus, Database } from "@/types/database";

export type AppointmentWithRelations = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  professional: { id: string; name: string } | null;
  service: { id: string; name: string; price_cents: number; duration_minutes: number } | null;
};

/**
 * Central appointment fetch + join used by the dashboard overview, the
 * agenda calendar, the appointments list and the customer history page.
 * Embedded resource selects (.select("*, foo(*)")) are avoided project-wide
 * since the hand-written database types don't describe real relationships
 * -- so this fetches appointments, then batch-fetches the referenced
 * customers/professionals/services and joins them in JS.
 */
export async function fetchAppointmentsWithRelations(
  supabase: SupabaseClient<Database>,
  businessId: string,
  filters: {
    fromISO?: string;
    toISO?: string;
    customerId?: string;
    professionalId?: string;
    statuses?: AppointmentStatus[];
    excludeStatuses?: AppointmentStatus[];
    search?: string;
    limit?: number;
    ascending?: boolean;
  } = {},
): Promise<AppointmentWithRelations[]> {
  let query = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, notes, customer_id, professional_id, service_id")
    .eq("business_id", businessId);

  if (filters.fromISO) query = query.gte("starts_at", filters.fromISO);
  if (filters.toISO) query = query.lte("starts_at", filters.toISO);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.professionalId) query = query.eq("professional_id", filters.professionalId);
  if (filters.statuses?.length) query = query.in("status", filters.statuses);
  if (filters.excludeStatuses?.length) {
    for (const status of filters.excludeStatuses) {
      query = query.neq("status", status);
    }
  }

  query = query.order("starts_at", { ascending: filters.ascending ?? true });
  if (filters.limit) query = query.limit(filters.limit);

  const { data: rows } = await query;
  const appointments = rows ?? [];

  const customerIds = [...new Set(appointments.map((a) => a.customer_id))];
  const professionalIds = [...new Set(appointments.map((a) => a.professional_id))];
  const serviceIds = [...new Set(appointments.map((a) => a.service_id))];

  const [{ data: customers }, { data: professionals }, { data: services }] =
    await Promise.all([
      customerIds.length
        ? supabase
            .from("customers")
            .select("id, name, phone, email")
            .in("id", customerIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; phone: string | null; email: string | null }[],
          }),
      professionalIds.length
        ? supabase.from("professionals").select("id, name").in("id", professionalIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      serviceIds.length
        ? supabase
            .from("services")
            .select("id, name, price_cents, duration_minutes")
            .in("id", serviceIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              price_cents: number;
              duration_minutes: number;
            }[],
          }),
    ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const professionalById = new Map((professionals ?? []).map((p) => [p.id, p]));
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  let joined: AppointmentWithRelations[] = appointments.map((appointment) => ({
    id: appointment.id,
    starts_at: appointment.starts_at,
    ends_at: appointment.ends_at,
    status: appointment.status,
    notes: appointment.notes,
    customer: customerById.get(appointment.customer_id) ?? null,
    professional: professionalById.get(appointment.professional_id) ?? null,
    service: serviceById.get(appointment.service_id) ?? null,
  }));

  if (filters.search?.trim()) {
    const term = filters.search.trim().toLowerCase();
    joined = joined.filter(
      (a) =>
        a.customer?.name.toLowerCase().includes(term) ||
        a.customer?.phone?.toLowerCase().includes(term),
    );
  }

  return joined;
}
