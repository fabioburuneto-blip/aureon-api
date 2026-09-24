"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);
  const searchParams = useSearchParams();
  const queryError = searchParams.get("error");

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-zinc-900">Entrar</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Acesse o painel da sua empresa.
        </p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {(state?.error || queryError) && (
            <p className="text-sm text-red-600">{state?.error ?? queryError}</p>
          )}

          <Button type="submit" disabled={pending} className="mt-2 w-full">
            {pending ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Ainda não tem uma conta?{" "}
          <Link
            href="/signup"
            className="font-medium text-zinc-900 hover:underline"
          >
            Criar conta
          </Link>
        </p>
      </Card>
    </div>
  );
}
