"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { updateBusinessImage } from "./actions";
import { Button } from "@/components/ui/button";

export function ImageUploader({
  businessId,
  kind,
  currentUrl,
  label,
}: {
  businessId: string;
  kind: "logo" | "cover";
  currentUrl: string | null;
  label: string;
}) {
  const [previewUrl, setPreviewUrl] = useState(currentUrl);
  const [error, setError] = useState<string | null>(null);
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

    const supabase = createClient();
    const extension = file.name.split(".").pop() ?? "jpg";
    const path = `${businessId}/${kind}-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("business-assets")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError("Falha no upload. Tente novamente.");
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("business-assets").getPublicUrl(path);

    setPreviewUrl(publicUrl);
    startTransition(async () => {
      const result = await updateBusinessImage(kind, publicUrl);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-zinc-700">{label}</p>
      {previewUrl && (
        <Image
          src={previewUrl}
          alt={label}
          width={160}
          height={90}
          unoptimized
          className="mb-2 h-20 w-36 rounded-lg border border-zinc-200 object-cover"
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileChange(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        {isPending ? "Enviando..." : "Escolher imagem"}
      </Button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
