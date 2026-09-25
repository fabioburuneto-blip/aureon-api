"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";

const customerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente").max(120),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().max(254).email().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type CustomerFormState = { error?: string } | undefined;

export async function createCustomer(
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const parsed = customerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase.from("customers").insert({
    business_id: business.id,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    notes: parsed.data.notes || null,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Já existe um cliente com esse telefone."
          : "Não foi possível salvar o cliente.",
    };
  }

  revalidatePath("/dashboard/customers");
}

export async function updateCustomer(
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Cliente inválido." };

  const parsed = customerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("customers")
    .update({
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", id.data)
    .eq("business_id", business.id);

  if (error) {
    return { error: "Não foi possível atualizar o cliente." };
  }

  revalidatePath("/dashboard/customers");
}

export async function deleteCustomer(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const { supabase, business } = await getCurrentBusiness();

  await supabase
    .from("customers")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/customers");
}
