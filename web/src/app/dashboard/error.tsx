"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Dashboard-scoped error boundary: a crash rendering one dashboard page
 * (agenda, clientes, etc.) shows this instead of taking down the whole
 * app shell or the public booking pages, which live outside this segment.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">
        Algo deu errado
      </h1>
      <p className="max-w-sm text-sm text-zinc-500">
        Não foi possível carregar esta página do painel. Tente novamente.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => retry()}>Tentar novamente</Button>
        <Link href="/dashboard">
          <Button variant="secondary">Voltar ao painel</Button>
        </Link>
      </div>
    </div>
  );
}
