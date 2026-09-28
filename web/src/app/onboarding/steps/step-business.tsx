"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createOnboardingBusiness } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import { businessSegments, segmentLabels } from "@/lib/validations";
import { slugify, isValidSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/client";

type AsyncSlugStatus = "idle" | "checking" | "available" | "taken";

export function StepBusiness() {
  const [state, formAction, pending] = useActionState(
    createOnboardingBusiness,
    undefined,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [asyncStatus, setAsyncStatus] = useState<AsyncSlugStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(slugify(value));
  }

  // Format validity is derived synchronously from `slug` on every render --
  // no effect needed for that part. Only the actual availability lookup
  // (an async round trip) needs an effect, and only once the format is
  // already known to be valid.
  const formatValid = slug.length > 0 && isValidSlug(slug);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // An invalid format never needs an availability lookup -- the render
    // below already shows "invalid" for that case regardless of
    // `asyncStatus`, so there's nothing to reset here.
    if (!formatValid) return;

    debounceRef.current = setTimeout(() => {
      setAsyncStatus("checking");
      void (async () => {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("is_slug_available", {
          p_slug: slug,
        });
        setAsyncStatus(error ? "idle" : data ? "available" : "taken");
      })();
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slug, formatValid]);

  const slugStatus: AsyncSlugStatus | "invalid" =
    slug.length > 0 && !formatValid ? "invalid" : asyncStatus;

  const slugHint: Record<typeof slugStatus, string | null> = {
    idle: null,
    checking: "Verificando disponibilidade...",
    available: "Disponível!",
    taken: "Esse endereço já está em uso.",
    invalid: "Use apenas letras minúsculas, números e hífens (mín. 3 caracteres).",
  };
  const slugHintColor =
    slugStatus === "available"
      ? "text-emerald-600"
      : slugStatus === "taken" || slugStatus === "invalid"
        ? "text-red-600"
        : "text-zinc-500";

  const canSubmit = name.trim().length >= 2 && slugStatus === "available";

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Vamos criar sua empresa</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Leva menos de um minuto. Você poderá ajustar tudo depois.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <div>
          <Label htmlFor="name">Nome da empresa</Label>
          <Input
            id="name"
            name="name"
            required
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Barbearia do Fábio"
          />
        </div>

        <div>
          <Label htmlFor="slug">Endereço público</Label>
          <div className="flex items-center gap-1 text-sm text-zinc-500">
            <span className="whitespace-nowrap">seusite.com/</span>
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="barbearia-do-fabio"
            />
          </div>
          {slugHint[slugStatus] && (
            <p className={`mt-1 text-sm ${slugHintColor}`}>{slugHint[slugStatus]}</p>
          )}
        </div>

        <div>
          <Label htmlFor="segment">Segmento</Label>
          <Select id="segment" name="segment" required defaultValue="">
            <option value="" disabled>
              Selecione...
            </option>
            {businessSegments.map((segment) => (
              <option key={segment} value={segment}>
                {segmentLabels[segment]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
            <Input id="whatsapp" name="whatsapp" placeholder="+55 11 99999-9999" />
          </div>
          <div>
            <Label htmlFor="instagram">Instagram (opcional)</Label>
            <Input id="instagram" name="instagram" placeholder="@suaempresa" />
          </div>
        </div>

        <FieldError message={state?.error} />

        <Button type="submit" disabled={pending || !canSubmit} className="mt-2 w-full">
          {pending ? "Criando..." : "Continuar"}
        </Button>
      </form>
    </div>
  );
}
