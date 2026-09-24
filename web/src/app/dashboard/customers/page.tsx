import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { NewCustomerForm } from "./new-customer-form";
import { CustomerRow } from "./customer-row";

export default async function CustomersPage() {
  const { supabase, business } = await getCurrentBusiness();

  const { data: customers } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", business.id)
    .order("name", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Clientes</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Clientes são criados automaticamente quando alguém agenda pela sua
          página pública.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-medium text-zinc-900">Novo cliente</h2>
        <NewCustomerForm />
      </Card>

      <Card>
        <h2 className="font-medium text-zinc-900">
          {customers?.length ?? 0} cliente{customers?.length === 1 ? "" : "s"}
        </h2>
        {!customers || customers.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum cliente cadastrado ainda.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {customers.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
