"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { publishOnboardingBusiness } from "../actions";
import { Button } from "@/components/ui/button";
import type { Database } from "@/types/database";

type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "slug" | "is_published"
>;

export function StepPublish({
  business,
  justPublished,
}: {
  business: Business;
  justPublished: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const publicUrl = `${siteUrl}/${business.slug}`;
  const published = business.is_published || justPublished;

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      const result = await publishOnboardingBusiness();
      if (result?.error) setError(result.error);
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) -- the URL is
      // still shown as plain text for the owner to select manually.
    }
  }

  if (!published) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Tudo pronto?</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ao publicar, sua página fica visível para qualquer pessoa com o
          link. Você pode voltar e ajustar qualquer coisa depois.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <Button
          onClick={handlePublish}
          disabled={isPending}
          className="mt-6 w-full"
        >
          {isPending ? "Publicando..." : "Publicar minha página"}
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold text-zinc-900">Seu link está pronto!</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Compartilhe com seus clientes para começar a receber agendamentos.
      </p>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
        <span className="flex-1 truncate text-left text-sm text-zinc-700">
          {publicUrl}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href={`/${business.slug}`} target="_blank" className="flex-1">
          <Button variant="secondary" className="w-full">
            Visualizar página
          </Button>
        </Link>
        <Link href="/dashboard" className="flex-1">
          <Button className="w-full">Ir para o painel</Button>
        </Link>
      </div>
    </div>
  );
}
