"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome"),
  email: z.string().trim().email("Informe um email válido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

export type SignupState = { error?: string; success?: boolean } | undefined;

export async function signup(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${siteUrl}/auth/confirm`,
    },
  });

  if (error) {
    return {
      error: error.message.includes("already registered")
        ? "Este email já está cadastrado."
        : "Não foi possível criar sua conta. Tente novamente.",
    };
  }

  return { success: true };
}
