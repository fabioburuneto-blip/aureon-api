"use client";

import { useActionState } from "react";
import {
  updateNotificationSettings,
  type NotificationSettingsFormState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";
import type { Database } from "@/types/database";

type BusinessSettings = Database["public"]["Tables"]["business_settings"]["Row"];

export function NotificationSettingsForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [state, formAction, pending] = useActionState<
    NotificationSettingsFormState,
    FormData
  >(updateNotificationSettings, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
          <input
            type="checkbox"
            name="whatsapp_enabled"
            defaultChecked={settings.whatsapp_enabled}
          />
          Enviar notificações por WhatsApp
        </label>
        <p className="text-xs text-zinc-500">
          Requer a integração com WhatsApp Business API habilitada pelo
          administrador do sistema. Veja{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5">
            docs/NOTIFICATIONS.md
          </code>{" "}
          para configurar as credenciais.
        </p>
        <div className="max-w-xs">
          <Label htmlFor="whatsapp_phone">Número do WhatsApp da empresa</Label>
          <Input
            id="whatsapp_phone"
            name="whatsapp_phone"
            placeholder="+5511999999999"
            defaultValue={settings.whatsapp_phone ?? ""}
          />
          <FieldError message={state?.error?.includes("WhatsApp") ? state.error : undefined} />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
          <input
            type="checkbox"
            name="notify_email_enabled"
            defaultChecked={settings.notify_email_enabled}
          />
          Enviar notificações por e-mail
        </label>
        <div className="max-w-xs">
          <Label htmlFor="notify_email_address">E-mail para receber avisos</Label>
          <Input
            id="notify_email_address"
            name="notify_email_address"
            type="email"
            placeholder="voce@suaempresa.com"
            defaultValue={settings.notify_email_address ?? ""}
          />
          <FieldError message={state?.error?.includes("e-mail") ? state.error : undefined} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-900">
          Quais eventos devem notificar (WhatsApp/e-mail)
        </p>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="notify_new_appointment"
            defaultChecked={settings.notify_new_appointment}
          />
          Novo agendamento
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="notify_cancellation"
            defaultChecked={settings.notify_cancellation}
          />
          Cancelamento
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="notify_reschedule"
            defaultChecked={settings.notify_reschedule}
          />
          Reagendamento
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="notify_reminder_24h"
            defaultChecked={settings.notify_reminder_24h}
          />
          Lembrete 24 horas antes
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="notify_reminder_2h"
            defaultChecked={settings.notify_reminder_2h}
          />
          Lembrete 2 horas antes
        </label>
      </div>

      {state?.error &&
        !state.error.includes("WhatsApp") &&
        !state.error.includes("e-mail") && (
          <FieldError message={state.error} />
        )}
      {state?.success && (
        <p className="text-sm text-emerald-600">Preferências salvas.</p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Salvar preferências"}
      </Button>
    </form>
  );
}
