"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, undefined);

  if (state?.success) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
        <Card className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold text-zinc-900">
            Confirme seu email
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Enviamos um link de confirmação para o email informado. Clique nele
            para ativar sua conta e começar a configurar sua empresa.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-zinc-900">Criar conta</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Comece a receber agendamentos em poucos minutos.
        </p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <div>
            <Label htmlFor="fullName">Nome completo</Label>
            <Input id="fullName" name="fullName" autoComplete="name" required />
          </div>
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <Button type="submit" disabled={pending} className="mt-2 w-full">
            {pending ? "Criando conta..." : "Criar conta"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Já tem uma conta?{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 hover:underline"
          >
            Entrar
          </Link>
        </p>
      </Card>
    </div>
  );
}
