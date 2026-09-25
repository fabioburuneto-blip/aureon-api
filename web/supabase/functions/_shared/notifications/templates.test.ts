import { describe, expect, it } from "vitest";
import { renderMessage } from "./templates.ts";
import type { NotificationPayload } from "./types.ts";

const payload: NotificationPayload = {
  customer_name: "Maria Souza",
  service_name: "Corte feminino",
  professional_name: "Ana",
  date_label: "25/12/2026",
  time_label: "14:30",
  business_name: "Salão Teste",
};

describe("renderMessage", () => {
  it("matches the exact requested format for a new appointment", () => {
    const message = renderMessage("appointment.created", payload);
    expect(message.body).toBe(
      "🔔 Novo agendamento\n" +
        "Cliente: Maria Souza\n" +
        "Serviço: Corte feminino\n" +
        "Profissional: Ana\n" +
        "Data: 25/12/2026\n" +
        "Horário: 14:30",
    );
    expect(message.title).toBe("Novo agendamento");
  });

  it("renders a cancellation message", () => {
    const message = renderMessage("appointment.cancelled", payload);
    expect(message.body).toContain("❌ Agendamento cancelado");
    expect(message.body).toContain("Cliente: Maria Souza");
  });

  it("renders a reschedule message with the new date/time", () => {
    const message = renderMessage("appointment.rescheduled", payload);
    expect(message.body).toContain("🔄 Agendamento reagendado");
    expect(message.body).toContain("Nova data: 25/12/2026");
    expect(message.body).toContain("Novo horário: 14:30");
  });

  it("renders 24h and 2h reminder messages", () => {
    expect(renderMessage("appointment.reminder_24h", payload).title).toBe(
      "Lembrete: agendamento amanhã",
    );
    expect(renderMessage("appointment.reminder_2h", payload).title).toBe(
      "Lembrete: agendamento em 2 horas",
    );
  });

  it("renders a non-empty title and body for every declared event type", () => {
    const events = [
      "appointment.created",
      "appointment.confirmed",
      "appointment.cancelled",
      "appointment.rescheduled",
      "appointment.completed",
      "appointment.no_show",
      "appointment.reminder_24h",
      "appointment.reminder_2h",
    ] as const;

    for (const event of events) {
      const message = renderMessage(event, payload);
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.body.length).toBeGreaterThan(0);
    }
  });
});
