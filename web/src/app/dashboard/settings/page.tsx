import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function SettingsPage() {
  const { supabase, business, role } = await getCurrentBusiness();

  const { data: settings } = await supabase
    .from("business_settings")
    .select("*")
    .eq("business_id", business.id)
    .single();

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

      <Card>
        <h2 className="mb-4 font-medium text-zinc-900">Notificações</h2>
        {role === "owner" && settings ? (
          <NotificationSettingsForm settings={settings} />
        ) : (
          <p className="text-sm text-zinc-500">
            Apenas o proprietário pode alterar as preferências de notificação.
          </p>
        )}
      </Card>
    </div>
  );
}
