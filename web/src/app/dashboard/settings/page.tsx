import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function SettingsPage() {
  const { supabase, business, role } = await getCurrentBusiness();

  // phone/email are no longer part of the businesses SELECT grant for
  // authenticated (see supabase/migrations/
  // 20250924120010_fix_businesses_authenticated_grant.sql) -- fetched
  // separately here, authorization-checked per business_id inside the
  // function itself instead of relying on a column grant.
  const [{ data: settings }, { data: contact }] = await Promise.all([
    supabase
      .from("business_settings")
      .select("*")
      .eq("business_id", business.id)
      .single(),
    supabase.rpc("get_business_contact", { p_business_id: business.id }),
  ]);

  const businessWithContact = {
    ...business,
    phone: contact?.[0]?.phone ?? null,
    email: contact?.[0]?.email ?? null,
  };

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
          <SettingsForm business={businessWithContact} />
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
