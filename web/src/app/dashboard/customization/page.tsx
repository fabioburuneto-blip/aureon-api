import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ThemeForm } from "./theme-form";
import { ImageUploader } from "./image-uploader";

export default async function CustomizationPage() {
  const { supabase, business } = await getCurrentBusiness();

  const { data: theme } = await supabase
    .from("themes")
    .select("*")
    .eq("business_id", business.id)
    .single();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Personalização</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Deixe sua página pública com a cara do seu negócio.
        </p>
      </div>

      <Card className="flex flex-col gap-6 sm:flex-row">
        <ImageUploader
          businessId={business.id}
          kind="logo"
          currentUrl={business.logo_url}
          label="Logo"
        />
        <ImageUploader
          businessId={business.id}
          kind="cover"
          currentUrl={business.cover_url}
          label="Imagem de capa"
        />
      </Card>

      <Card>{theme && <ThemeForm theme={theme} />}</Card>
    </div>
  );
}
