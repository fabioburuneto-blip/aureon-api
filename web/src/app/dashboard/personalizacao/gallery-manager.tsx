"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { addGalleryPhoto, removeGalleryPhoto } from "./actions";
import { Button } from "@/components/ui/button";

type Photo = { id: string; image_url: string };

export function GalleryManager({
  businessId,
  initialPhotos,
}: {
  businessId: string;
  initialPhotos: Photo[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(file: File) {
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("A imagem deve ter até 5MB.");
      return;
    }
    if (photos.length >= 12) {
      setError("Limite de 12 fotos na galeria.");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const extension = file.name.split(".").pop() ?? "jpg";
    const path = `${businessId}/gallery-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("business-assets")
      .upload(path, file);

    if (uploadError) {
      setUploading(false);
      setError("Falha no upload. Tente novamente.");
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("business-assets").getPublicUrl(path);

    const result = await addGalleryPhoto(publicUrl);
    setUploading(false);

    if (result?.error || !result?.photo) {
      setError(result?.error ?? "Não foi possível adicionar a foto.");
      return;
    }

    setPhotos((prev) => [...prev, result.photo]);
  }

  function handleRemove(photoId: string) {
    setError(null);
    const previous = photos;
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    startTransition(async () => {
      const result = await removeGalleryPhoto(photoId);
      if (result?.error) {
        setError(result.error);
        setPhotos(previous);
      }
    });
  }

  return (
    <div>
      {photos.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200">
              <Image src={photo.image_url} alt="" fill className="object-cover" sizes="150px" />
              <button
                type="button"
                onClick={() => handleRemove(photo.id)}
                disabled={isPending}
                className="absolute top-1 right-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileChange(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={uploading || photos.length >= 12}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Enviando..." : "Adicionar foto"}
      </Button>
      <p className="mt-1 text-xs text-zinc-400">{photos.length}/12 fotos</p>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
