"use client";

import { useActionState, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelPublicAppointment, reschedulePublicAppointment, type PortalActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { FieldError } from "@/components/ui/input";
import { formatDateLong, formatDuration, formatPriceCents, formatTime } from "@/lib/format";
import type { Database } from "@/types/database";

type PublicAppointment = Database["public"]["Functions"]["get_public_appointment"]["Returns"][number];
type Slot = { slot_start: string; slot_end: string };

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  no_show: "Não compareceu",
};

function buildDateChips(count: number) {
  const chips: { iso: string; weekday: string; day: number; month: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    chips.push({
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      weekday: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase(),
      day: d.getDate(),
      month: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    });
  }
  return chips;
}

export function AppointmentPortal({
  appointment,
  token,
}: {
  appointment: PublicAppointment;
  token: string;
}) {
  const [mode, setMode] = useState<"view" | "reschedule-date" | "reschedule-time">("view");
  const [selectedDateLabel, setSelectedDateLabel] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [cancelState, cancelAction, cancelPending] = useActionState<
    PortalActionState,
    FormData
  >(cancelPublicAppointment, undefined);
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState<
    PortalActionState,
    FormData
  >(reschedulePublicAppointment, undefined);

  const dateChips = useMemo(() => buildDateChips(30), []);

  async function loadSlots(nextDate: string) {
    setLoadingSlots(true);
    setSelectedSlot(null);
    const supabase = createClient();
    const { data } = await supabase.rpc("get_available_slots", {
      p_business_slug: appointment.business_slug,
      p_service_id: appointment.service_id,
      p_professional_id: appointment.professional_id,
      p_date: nextDate,
    });
    setSlots(data ?? []);
    setLoadingSlots(false);
  }

  const statusLabel = STATUS_LABELS[appointment.status] ?? appointment.status;

  if (rescheduleState?.success) {
    // revalidatePath already refreshed the server-fetched `appointment`
    // prop on next navigation, but useActionState keeps this component
    // mounted with the old prop until then -- show a simple confirmation
    // instead of stale details.
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="font-medium text-emerald-900">Agendamento reagendado!</h2>
        <p className="mt-2 text-sm text-emerald-700">
          Atualize a página para ver o novo horário.
        </p>
      </div>
    );
  }

  if (cancelState?.success || appointment.status === "cancelled") {
    return (
      <div className="rounded-xl border border-zinc-200 p-6">
        <h2 className="font-medium text-zinc-900">Agendamento cancelado</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Este agendamento foi cancelado e o horário foi liberado.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-medium text-zinc-900">{appointment.business_name}</h1>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
            {statusLabel}
          </span>
        </div>

        <dl className="flex flex-col gap-1.5 text-sm">
          <Row label="Serviço" value={appointment.service_name} />
          <Row label="Profissional" value={appointment.professional_name} />
          <Row label="Data" value={formatDateLong(appointment.starts_at, appointment.business_timezone)} />
          <Row label="Horário" value={formatTime(appointment.starts_at, appointment.business_timezone)} />
          <Row label="Duração" value={formatDuration(appointment.service_duration_minutes)} />
          <Row label="Preço" value={formatPriceCents(appointment.service_price_cents)} />
          {appointment.business_address && <Row label="Endereço" value={appointment.business_address} />}
        </dl>

        {appointment.business_whatsapp && (
          <a
            href={`https://wa.me/${appointment.business_whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm font-medium text-emerald-700 underline"
          >
            Falar com a empresa no WhatsApp
          </a>
        )}
      </div>

      {mode === "view" && (appointment.can_cancel || appointment.can_reschedule) && (
        <div className="flex flex-col gap-3">
          {appointment.can_reschedule && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMode("reschedule-date")}
            >
              Reagendar
            </Button>
          )}

          {appointment.can_cancel && (
            <form action={cancelAction}>
              <input type="hidden" name="token" value={token} />
              <ConfirmSubmitButton
                confirmMessage="Tem certeza que deseja cancelar este agendamento?"
                className="h-10 w-full rounded-lg border border-red-200 text-center"
                disabled={cancelPending}
              >
                {cancelPending ? "Cancelando..." : "Cancelar agendamento"}
              </ConfirmSubmitButton>
            </form>
          )}

          <FieldError message={cancelState?.error} />
        </div>
      )}

      {mode === "view" && !appointment.can_cancel && !appointment.can_reschedule && (
        <p className="text-sm text-zinc-500">
          Este agendamento não pode mais ser cancelado ou reagendado (prazo de{" "}
          {appointment.client_min_notice_hours}h de antecedência, ou o status atual não
          permite alteração).
        </p>
      )}

      {mode === "reschedule-date" && (
        <div className="rounded-xl border border-zinc-200 p-5">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMode("view")}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
            >
              ← Voltar
            </button>
            <span className="text-xs font-medium text-zinc-400">Escolha a nova data</span>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {dateChips.map((chip) => (
              <button
                key={chip.iso}
                type="button"
                onClick={() => {
                  setSelectedDateLabel(`${chip.weekday}, ${chip.day} de ${chip.month}`);
                  setMode("reschedule-time");
                  void loadSlots(chip.iso);
                }}
                className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-zinc-200 text-xs hover:border-zinc-400"
              >
                <span>{chip.weekday}</span>
                <span className="text-base font-semibold">{chip.day}</span>
                <span>{chip.month}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "reschedule-time" && (
        <div className="rounded-xl border border-zinc-200 p-5">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMode("reschedule-date")}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
            >
              ← Voltar
            </button>
            <span className="text-xs font-medium text-zinc-400">
              {selectedDateLabel || "Escolha o horário"}
            </span>
          </div>

          {loadingSlots ? (
            <p className="text-sm text-zinc-500">Carregando horários...</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum horário disponível neste dia.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <button
                  key={slot.slot_start}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className="rounded-lg border px-2 py-2 text-sm"
                  style={
                    selectedSlot?.slot_start === slot.slot_start
                      ? { backgroundColor: "#111827", borderColor: "#111827", color: "white" }
                      : { borderColor: "#e4e4e7" }
                  }
                >
                  {formatTime(slot.slot_start, appointment.business_timezone)}
                </button>
              ))}
            </div>
          )}

          {selectedSlot && (
            <form action={rescheduleAction} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="starts_at" value={selectedSlot.slot_start} />
              <FieldError message={rescheduleState?.error} />
              <Button type="submit" disabled={reschedulePending} className="w-full">
                {reschedulePending ? "Reagendando..." : "Confirmar novo horário"}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-zinc-900">{value}</dd>
    </div>
  );
}
