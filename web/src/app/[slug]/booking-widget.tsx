"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publicBookingSchema } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatPriceCents, formatTime, formatDateLong, formatDuration } from "@/lib/format";
import { BookingSuccess } from "./booking-success";
import type { Database } from "@/types/database";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Professional = Database["public"]["Tables"]["professionals"]["Row"];
type Slot = { slot_start: string; slot_end: string };
type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];

type Step =
  | "service"
  | "professional"
  | "date"
  | "time"
  | "details"
  | "review";

const STEP_ORDER: Step[] = [
  "service",
  "professional",
  "date",
  "time",
  "details",
  "review",
];

const STEP_LABELS: Record<Step, string> = {
  service: "Serviço",
  professional: "Profissional",
  date: "Data",
  time: "Horário",
  details: "Seus dados",
  review: "Revisão",
};

const DATE_CHIP_COUNT = 30;

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

export function BookingWidget({
  businessSlug,
  businessName,
  timezone,
  services,
  professionals,
  servicesByProfessional,
  primaryColor,
  previewMode = false,
}: {
  businessSlug: string;
  businessName: string;
  timezone: string;
  services: Service[];
  professionals: Professional[];
  servicesByProfessional: Map<string, string[]>;
  primaryColor: string;
  /** Only set by /dashboard/preview -- renders the exact same wizard UI
   * (including real available slots, since reading them is harmless) but
   * never calls create_public_appointment while this is true. Defaults
   * to false, so the real public page's behavior never writes anything
   * unless a real visitor confirms. */
  previewMode?: boolean;
}) {
  const [step, setStep] = useState<Step>("service");
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<AppointmentRow | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const professional = professionals.find((p) => p.id === professionalId) ?? null;

  const availableProfessionals = useMemo(() => {
    if (!serviceId) return [];
    return professionals.filter((p) =>
      servicesByProfessional.get(p.id)?.includes(serviceId),
    );
  }, [serviceId, professionals, servicesByProfessional]);

  const dateChips = useMemo(() => buildDateChips(DATE_CHIP_COUNT), []);

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function goBack() {
    const index = STEP_ORDER.indexOf(step);
    if (index > 0) goTo(STEP_ORDER[index - 1]!);
  }

  async function loadSlots(nextProfessionalId: string, nextDate: string) {
    setLoadingSlots(true);
    setSelectedSlot(null);
    const supabase = createClient();
    const { data } = await supabase.rpc("get_available_slots", {
      p_business_slug: businessSlug,
      p_service_id: serviceId,
      p_professional_id: nextProfessionalId,
      p_date: nextDate,
    });
    setSlots(data ?? []);
    setLoadingSlots(false);
  }

  function handleSelectService(id: string) {
    setServiceId(id);
    setProfessionalId("");
    setDate("");
    setSlots([]);
    setSelectedSlot(null);
    goTo("professional");
  }

  function handleSelectProfessional(id: string) {
    setProfessionalId(id);
    setDate("");
    setSlots([]);
    setSelectedSlot(null);
    goTo("date");
  }

  function handleSelectDate(iso: string) {
    setDate(iso);
    goTo("time");
    void loadSlots(professionalId, iso);
  }

  function handleSelectSlot(slot: Slot) {
    setSelectedSlot(slot);
    goTo("details");
  }

  function handleDetailsSubmit(formData: FormData) {
    const name = String(formData.get("customer_name") ?? "").trim();
    const phone = String(formData.get("customer_phone") ?? "").trim();
    const email = String(formData.get("customer_email") ?? "").trim();
    const noteText = String(formData.get("notes") ?? "").trim();

    const parsed = publicBookingSchema.safeParse({
      service_id: serviceId,
      professional_id: professionalId,
      starts_at: selectedSlot?.slot_start ?? "",
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      notes: noteText,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setCustomerName(name);
    setCustomerPhone(phone);
    setCustomerEmail(email);
    setNotes(noteText);
    goTo("review");
  }

  async function handleConfirm() {
    if (!service || !professional || !selectedSlot) return;
    setError(null);

    // Preview mode never calls create_public_appointment -- there is no
    // code path from previewMode=true to the RPC at all, not just "the
    // owner won't click confirm".
    if (previewMode) {
      setConfirmed({
        id: "preview",
        business_id: "preview",
        customer_id: "preview",
        professional_id: professional.id,
        service_id: service.id,
        starts_at: selectedSlot.slot_start,
        ends_at: selectedSlot.slot_end,
        status: "pending",
        notes: null,
        reminder_24h_sent_at: null,
        reminder_2h_sent_at: null,
        client_token: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "create_public_appointment",
      {
        p_business_slug: businessSlug,
        p_service_id: service.id,
        p_professional_id: professional.id,
        p_starts_at: selectedSlot.slot_start,
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_customer_email: customerEmail || undefined,
        p_notes: notes || undefined,
      },
    );
    setSubmitting(false);

    if (rpcError || !data) {
      setError(
        rpcError?.message.includes("no longer available")
          ? "Esse horário acabou de ser reservado. Escolha outro."
          : "Não foi possível concluir o agendamento. Tente novamente.",
      );
      return;
    }

    setConfirmed(data);
  }

  if (services.length === 0 || professionals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500">
        Esta empresa ainda não está aceitando agendamentos online.
      </div>
    );
  }

  if (confirmed && service && professional) {
    return (
      <BookingSuccess
        businessName={businessName}
        serviceName={service.name}
        professionalName={professional.name}
        durationMinutes={service.duration_minutes}
        priceCents={service.price_cents}
        startsAtIso={confirmed.starts_at}
        endsAtIso={confirmed.ends_at}
        timezone={timezone}
        clientToken={previewMode ? null : confirmed.client_token || null}
        previewMode={previewMode}
      />
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="rounded-xl border border-zinc-200 p-5">
      <div className="mb-4 flex items-center justify-between">
        {stepIndex > 0 ? (
          <button
            type="button"
            onClick={goBack}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
          >
            ← Voltar
          </button>
        ) : (
          <span />
        )}
        <span className="text-xs font-medium text-zinc-400">
          Passo {stepIndex + 1} de {STEP_ORDER.length}
        </span>
      </div>

      <h2 className="mb-4 font-medium text-zinc-900">{STEP_LABELS[step]}</h2>

      {step === "service" && (
        <div className="flex flex-col gap-2">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelectService(s.id)}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-left hover:border-zinc-400"
            >
              <div>
                <p className="font-medium text-zinc-900">{s.name}</p>
                {s.description && (
                  <p className="text-sm text-zinc-500">{s.description}</p>
                )}
                <p className="text-sm text-zinc-400">{formatDuration(s.duration_minutes)}</p>
              </div>
              <span className="shrink-0 font-medium text-zinc-900">
                {formatPriceCents(s.price_cents)}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === "professional" && (
        <div className="flex flex-col gap-2">
          {availableProfessionals.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nenhum profissional disponível para este serviço no momento.
            </p>
          ) : (
            availableProfessionals.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProfessional(p.id)}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 text-left hover:border-zinc-400"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-600">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="font-medium text-zinc-900">{p.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      {step === "date" && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {dateChips.map((chip) => (
            <button
              key={chip.iso}
              type="button"
              onClick={() => handleSelectDate(chip.iso)}
              className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border text-xs"
              style={
                date === chip.iso
                  ? { backgroundColor: primaryColor, borderColor: primaryColor, color: "white" }
                  : { borderColor: "#e4e4e7" }
              }
            >
              <span>{chip.weekday}</span>
              <span className="text-base font-semibold">{chip.day}</span>
              <span>{chip.month}</span>
            </button>
          ))}
        </div>
      )}

      {step === "time" && (
        <div>
          {loadingSlots ? (
            <p className="text-sm text-zinc-500">Carregando horários...</p>
          ) : slots.length === 0 ? (
            <div>
              <p className="text-sm text-zinc-500">
                Nenhum horário disponível neste dia.
              </p>
              <button
                type="button"
                onClick={() => goTo("date")}
                className="mt-3 text-sm font-medium underline"
                style={{ color: primaryColor }}
              >
                Escolher outra data
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <button
                  key={slot.slot_start}
                  type="button"
                  onClick={() => handleSelectSlot(slot)}
                  className="rounded-lg border px-2 py-2 text-sm"
                  style={
                    selectedSlot?.slot_start === slot.slot_start
                      ? { backgroundColor: primaryColor, borderColor: primaryColor, color: "white" }
                      : { borderColor: "#e4e4e7" }
                  }
                >
                  {formatTime(slot.slot_start, timezone)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "details" && (
        <form action={handleDetailsSubmit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="customer_name">Seu nome</Label>
            <Input
              id="customer_name"
              name="customer_name"
              required
              defaultValue={customerName}
            />
          </div>
          <div>
            <Label htmlFor="customer_phone">WhatsApp</Label>
            <Input
              id="customer_phone"
              name="customer_phone"
              required
              placeholder="(11) 99999-9999"
              defaultValue={customerPhone}
            />
          </div>
          <div>
            <Label htmlFor="customer_email">Email (opcional)</Label>
            <Input
              id="customer_email"
              name="customer_email"
              type="email"
              defaultValue={customerEmail}
            />
          </div>
          <div>
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={notes} />
          </div>

          <FieldError message={error ?? undefined} />

          <Button type="submit" className="w-full">
            Revisar agendamento
          </Button>
        </form>
      )}

      {step === "review" && service && professional && selectedSlot && (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <ReviewRow label="Serviço" value={service.name} />
            <ReviewRow label="Profissional" value={professional.name} />
            <ReviewRow label="Data" value={formatDateLong(selectedSlot.slot_start, timezone)} />
            <ReviewRow label="Horário" value={formatTime(selectedSlot.slot_start, timezone)} />
            <ReviewRow label="Duração" value={formatDuration(service.duration_minutes)} />
            <ReviewRow label="Preço" value={formatPriceCents(service.price_cents)} />
            <div className={cn("mt-2 border-t border-zinc-100 pt-2")} />
            <ReviewRow label="Nome" value={customerName} />
            <ReviewRow label="WhatsApp" value={customerPhone} />
          </dl>

          <FieldError message={error ?? undefined} />

          <Button
            type="button"
            disabled={submitting}
            className="w-full"
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Confirmando..." : "Confirmar agendamento"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-zinc-900">{value}</dd>
    </div>
  );
}
