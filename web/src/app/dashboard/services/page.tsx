import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { NewServiceForm } from "./new-service-form";
import { ServiceRow } from "./service-row";

export default async function ServicesPage(props: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await props.searchParams;
  const { supabase, business } = await getCurrentBusiness();

  const { data: services } = await supabase
    .from("services")
    .select("*")
    .eq("business_id", business.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Serviços</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cadastre os serviços que sua empresa oferece, com duração e preço.
        </p>
        {welcome && (
          <p className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white">
            Empresa criada! Cadastre pelo menos um serviço e um profissional
            para publicar sua agenda.
          </p>
        )}
      </div>

      <Card>
        <h2 className="mb-3 font-medium text-zinc-900">Novo serviço</h2>
        <NewServiceForm />
      </Card>

      <Card>
        <h2 className="font-medium text-zinc-900">Seus serviços</h2>
        {!services || services.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum serviço cadastrado ainda.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {services.map((service, index) => (
              <ServiceRow
                key={service.id}
                service={service}
                isFirst={index === 0}
                isLast={index === services.length - 1}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
