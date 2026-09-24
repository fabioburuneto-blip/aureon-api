"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCustomer, type CustomerFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export function NewCustomerForm() {
  const [state, formAction, pending] = useActionState<
    CustomerFormState,
    FormData
  >(createCustomer, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="new-c-name">Nome</Label>
          <Input id="new-c-name" name="name" required />
        </div>
        <div>
          <Label htmlFor="new-c-phone">Telefone</Label>
          <Input id="new-c-phone" name="phone" />
        </div>
        <div>
          <Label htmlFor="new-c-email">Email</Label>
          <Input id="new-c-email" name="email" type="email" />
        </div>
      </div>

      <FieldError message={state?.error} />

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adicionando..." : "Adicionar cliente"}
      </Button>
    </form>
  );
}
