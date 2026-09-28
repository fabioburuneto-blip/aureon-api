import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { normalizeSectionsConfig } from "@/lib/sections";
import { ImageUploader } from "./image-uploader";
import { DescriptionForm } from "./description-form";
import { GalleryManager } from "./gallery-manager";
import { ColorsForm } from "./colors-form";
import { PresetPicker } from "./preset-picker";
import { SocialForm } from "./social-form";
import { LocationForm } from "./location-form";
import { SectionsForm } from "./sections-form";
import type { Database } from "@/types/database";

type PersonalizationBusiness = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "id" | "logo_url" | "cover_url" | "description" | "whatsapp" | "instagram" | "address" | "city"
>;

export default async function PersonalizationPage() {
  const { supabase, business } = await getCurrentBusiness();

  const [{ data: fullBusiness }, { data: theme }, { data: gallery }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, logo_url, cover_url, description, whatsapp, instagram, address, city")
      .eq("id", business.id)
      .returns<PersonalizationBusiness[]>()
      .single(),
    supabase.from("themes").select("*").eq("business_id", business.id).single(),
    supabase
      .from("business_gallery")
      .select("id, image_url")
      .eq("business_id", business.id)
      .order("position", { ascending: true }),
  ]);

  if (!fullBusiness) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Personalização</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Deixe sua página pública com a cara do seu negócio.
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-medium text-zinc-900">Identidade</h2>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 sm:flex-row">
            <ImageUploader
              businessId={fullBusiness.id}
              kind="logo"
              currentUrl={fullBusiness.logo_url}
              label="Logo"
            />
            <ImageUploader
              businessId={fullBusiness.id}
              kind="cover"
              currentUrl={fullBusiness.cover_url}
              label="Imagem de capa"
            />
          </div>
          <DescriptionForm description={fullBusiness.description} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-medium text-zinc-900">Galeria</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Fotos extras do seu espaço, exibidas na seção Galeria da página pública.
        </p>
        <GalleryManager businessId={fullBusiness.id} initialPhotos={gallery ?? []} />
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-medium text-zinc-900">Cores</h2>
        {theme && <ColorsForm theme={theme} />}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-medium text-zinc-900">Estilo</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Escolha o tema visual da sua página pública.
        </p>
        {theme && <PresetPicker currentPreset={theme.preset} />}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-medium text-zinc-900">Redes sociais</h2>
        <SocialForm whatsapp={fullBusiness.whatsapp} instagram={fullBusiness.instagram} />
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-medium text-zinc-900">Localização</h2>
        <LocationForm address={fullBusiness.address} city={fullBusiness.city} />
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-medium text-zinc-900">Seções da página pública</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Mostre, oculte e reordene as seções da sua página. Capa, Agendamento e Rodapé
          são sempre exibidos.
        </p>
        {theme && <SectionsForm initialSections={normalizeSectionsConfig(theme.sections)} />}
      </Card>
    </div>
  );
}
