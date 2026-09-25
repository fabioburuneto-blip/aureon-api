"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Catches an uncaught render/server error anywhere under the root layout
 * (marketing site, /login, /signup, /[slug] public pages) and shows a
 * branded fallback instead of Next.js's default error screen. Runs in the
 * browser (error boundaries are always Client Components), so this
 * console.error is a devtools trace for whoever is looking, not a server
 * log -- server-side errors (server actions, route handlers, RSC data
 * fetching) are already logged via src/lib/logger.ts before they reach
 * this boundary. See docs/DEPLOY.md "Observabilidade" for the upgrade
 * path to a real error-tracking service that would also capture this.
 */
export default function ErrorBoundary({
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-white px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">
        Algo deu errado
      </h1>
      <p className="max-w-sm text-sm text-zinc-500">
        Não foi possível carregar esta página. Tente novamente em instantes.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => retry()}>Tentar novamente</Button>
        <Link href="/">
          <Button variant="secondary">Voltar ao início</Button>
        </Link>
      </div>
    </div>
  );
}
