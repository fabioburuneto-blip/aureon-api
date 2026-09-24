"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publicBookingSchema } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import { formatPriceCents, formatTime, formatDateTime } from "@/lib/format";
import type { Database } from "@/types/database";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Professional = Database["public"]["Tables"]["professionals"]["Row"];
type Slot = { slot_start: string; slot_end: string };

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function maxISODate() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

export function BookingWidget({
  businessSlug,
  timezone,
  services,
  professionals,
  servicesByProfessional,
  primaryColor,
}: {
  businessSlug: string;
  timezone: string;
  services: Service[];
  professionals: Professional[];
  servicesByProfessional: Map<string, string[]>;
  primaryColor: string;
}) {
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  const availableProfessionals = useMemo(() => {
    if (!serviceId) return [];
    return professionals.filter((p) =>
      servicesByProfessional.get(p.id)?.includes(serviceId),
    );
  }, [serviceId, professionals, servicesByProfessional]);

  async function loadSlots(
    nextServiceId: string,
    nextProfessionalId: string,
    nextDate: string,
  ) {
    if (!nextServiceId || !nextProfessionalId || !nextDate) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSelectedSlot(null);
    const supabase = createClient();
    const { data } = await supabase.rpc("get_available_slots", {
      p_business_slug: businessSlug,
      p_service_id: nextServiceId,
      p_professional_id: nextProfessionalId,
      p_date: nextDate,
    });
    setSlots(data ?? []);
    setLoadingSlots(false);
  }

  if (services.length === 0 || professionals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500">
        Esta empresa ainda não está aceitando agendamentos online.
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="font-medium text-emerald-900">
          Agendamento confirmado!
        </h3>
        <p className="mt-2 text-sm text-emerald-800">
          {formatDateTime(confirmed.slot_start, timezone)}
        </p>
        <p className="mt-1 text-sm text-emerald-700">
          Você receberá a confirmação diretamente com a empresa.
        </p>
      </div>
    );
  }

  return (
    <div className="sticky top-4 rounded-xl border border-zinc-200 p-5">
      <h2 className="mb-4 font-medium text-zinc-900">Agendar horário</h2>

      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="booking-service">Serviço</Label>
          <Select
            id="booking-service"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setProfessionalId("");
              setSlots([]);
              setSelectedSlot(null);
            }}
          >
            <option value="">Selecione...</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} — {formatPriceCents(service.price_cents)}
              </option>
            ))}
          </Select>
        </div>

        {serviceId && (
          <div>
            <Label htmlFor="booking-professional">Profissional</Label>
            <Select
              id="booking-professional"
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(e.target.value);
                void loadSlots(serviceId, e.target.value, date);
              }}
            >
              <option value="">Selecione...</option>
              {availableProfessionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {professionalId && (
          <div>
            <Label htmlFor="booking-date">Data</Label>
            <Input
              id="booking-date"
              type="date"
              min={todayISODate()}
              max={maxISODate()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                void loadSlots(serviceId, professionalId, e.target.value);
              }}
            />
          </div>
        )}

        {professionalId && (
          <div>
            <Label>Horário</Label>
            {loadingSlots ? (
              <p className="text-sm text-zinc-500">Carregando horários...</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nenhum horário disponível neste dia.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.slot_start}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={
                      selectedSlot?.slot_start === slot.slot_start
                        ? {
                            backgroundColor: primaryColor,
                            borderColor: primaryColor,
                            color: "white",
                          }
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

        {selectedSlot && (
          <BookingDetailsForm
            businessSlug={businessSlug}
            serviceId={serviceId}
            professionalId={professionalId}
            slot={selectedSlot}
            submitting={submitting}
            setSubmitting={setSubmitting}
            error={error}
            setError={setError}
            onSuccess={() => setConfirmed(selectedSlot)}
          />
        )}
      </div>
    </div>
  );
}

function BookingDetailsForm({
  businessSlug,
  serviceId,
  professionalId,
  slot,
  submitting,
  setSubmitting,
  error,
  setError,
  onSuccess,
}: {
  businessSlug: string;
  serviceId: string;
  professionalId: string;
  slot: Slot;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  onSuccess: () => void;
}) {
  async function handleSubmit(formData: FormData) {
    setError(null);

    const parsed = publicBookingSchema.safeParse({
      service_id: serviceId,
      professional_id: professionalId,
      starts_at: slot.slot_start,
      customer_name: formData.get("customer_name"),
      customer_phone: formData.get("customer_phone"),
      customer_email: formData.get("customer_email"),
      notes: formData.get("notes"),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(
      "create_public_appointment",
      {
        p_business_slug: businessSlug,
        p_service_id: parsed.data.service_id,
        p_professional_id: parsed.data.professional_id,
        p_starts_at: parsed.data.starts_at,
        p_customer_name: parsed.data.customer_name,
        p_customer_phone: parsed.data.customer_phone,
        p_customer_email: parsed.data.customer_email || undefined,
        p_notes: parsed.data.notes || undefined,
      },
    );
    setSubmitting(false);

    if (rpcError) {
      setError(
        rpcError.message.includes("no longer available")
          ? "Esse horário acabou de ser reservado. Escolha outro."
          : "Não foi possível concluir o agendamento. Tente novamente.",
      );
      return;
    }

    onSuccess();
  }

  return (
    <form
      action={handleSubmit}
      className="flex flex-col gap-3 border-t border-zinc-100 pt-4"
    >
      <div>
        <Label htmlFor="customer_name">Seu nome</Label>
        <Input id="customer_name" name="customer_name" required />
      </div>
      <div>
        <Label htmlFor="customer_phone">Telefone (WhatsApp)</Label>
        <Input
          id="customer_phone"
          name="customer_phone"
          required
          placeholder="(11) 99999-9999"
        />
      </div>
      <div>
        <Label htmlFor="customer_email">Email (opcional)</Label>
        <Input id="customer_email" name="customer_email" type="email" />
      </div>
      <div>
        <Label htmlFor="notes">Observações (opcional)</Label>
        <Input id="notes" name="notes" />
      </div>

      <FieldError message={error ?? undefined} />

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Confirmando..." : "Confirmar agendamento"}
      </Button>
    </form>
  );
}
