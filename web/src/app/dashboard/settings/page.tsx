import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const { business, role } = await getCurrentBusiness();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Configurações</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Dados gerais e visibilidade da sua empresa.
        </p>
      </div>

      <Card>
        {role === "owner" ? (
          <SettingsForm business={business} />
        ) : (
          <p className="text-sm text-zinc-500">
            Apenas o proprietário pode alterar as configurações da empresa.
          </p>
        )}
      </Card>
    </div>
  );
}
