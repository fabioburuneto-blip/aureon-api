import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Global 404 -- also what `notFound()` renders for an unknown/unpublished
 * business slug in src/app/[slug]/page.tsx, since that route has no more
 * specific not-found.tsx of its own.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-white px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">
        Página não encontrada
      </h1>
      <p className="max-w-sm text-sm text-zinc-500">
        O endereço que você acessou não existe ou não está mais disponível.
      </p>
      <Link href="/">
        <Button>Voltar ao início</Button>
      </Link>
    </div>
  );
}
