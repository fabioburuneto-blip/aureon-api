import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { NewProfessionalForm } from "./new-professional-form";
import { ProfessionalRow } from "./professional-row";

export default async function ProfessionalsPage() {
  const { supabase, business } = await getCurrentBusiness();

  const [{ data: professionals }, { data: services }, { data: links }] =
    await Promise.all([
      supabase
        .from("professionals")
        .select("*")
        .eq("business_id", business.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("services")
        .select("*")
        .eq("business_id", business.id)
        .order("position", { ascending: true }),
      supabase
        .from("professional_services")
        .select("professional_id, service_id"),
    ]);

  const servicesByProfessional = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = servicesByProfessional.get(link.professional_id) ?? [];
    list.push(link.service_id);
    servicesByProfessional.set(link.professional_id, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Profissionais</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cadastre quem realiza os atendimentos e quais serviços cada um
          oferece.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-medium text-zinc-900">Novo profissional</h2>
        <NewProfessionalForm services={services ?? []} />
      </Card>

      <Card>
        <h2 className="font-medium text-zinc-900">Sua equipe</h2>
        {!professionals || professionals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum profissional cadastrado ainda.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {professionals.map((professional) => (
              <ProfessionalRow
                key={professional.id}
                professional={professional}
                services={services ?? []}
                selectedServiceIds={
                  servicesByProfessional.get(professional.id) ?? []
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
