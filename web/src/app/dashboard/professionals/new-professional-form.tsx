"use client";

import { useActionState, useEffect, useRef } from "react";
import { createProfessional, type ProfessionalFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { ServiceCheckboxes } from "./service-checkboxes";
import type { Database } from "@/types/database";

type Service = Database["public"]["Tables"]["services"]["Row"];

export function NewProfessionalForm({ services }: { services: Service[] }) {
  const [state, formAction, pending] = useActionState<
    ProfessionalFormState,
    FormData
  >(createProfessional, undefined);
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
      <div>
        <Label htmlFor="new-prof-name">Nome</Label>
        <Input id="new-prof-name" name="name" placeholder="Fábio" required />
      </div>
      <div>
        <Label htmlFor="new-prof-bio">Bio (opcional)</Label>
        <Textarea id="new-prof-bio" name="bio" rows={2} />
      </div>
      <div>
        <Label>Serviços que realiza</Label>
        <ServiceCheckboxes
          idPrefix="new-prof"
          services={services}
          selectedIds={[]}
        />
      </div>

      <FieldError message={state?.error} />

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adicionando..." : "Adicionar profissional"}
      </Button>
    </form>
  );
}
