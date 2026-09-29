import { describe, expect, it } from "vitest";
import { mapPublicAppointmentError } from "./errors";

describe("mapPublicAppointmentError", () => {
  it("gives one generic message for a nonexistent/invalid token", () => {
    expect(mapPublicAppointmentError("appointment not found")).toBe(
      "Este link de agendamento não é válido ou expirou.",
    );
  });

  it("distinguishes the cancellation window from the reschedule window", () => {
    expect(mapPublicAppointmentError("cancellation window has passed")).toBe(
      "O prazo para cancelar este agendamento já passou.",
    );
    expect(mapPublicAppointmentError("reschedule window has passed")).toBe(
      "O prazo para reagendar este agendamento já passou.",
    );
  });

  it("gives a status-transition message for cancelled/completed/no_show", () => {
    expect(
      mapPublicAppointmentError("this appointment can no longer be cancelled"),
    ).toBe("Este agendamento não pode mais ser alterado.");
    expect(
      mapPublicAppointmentError("this appointment can no longer be rescheduled"),
    ).toBe("Este agendamento não pode mais ser alterado.");
  });

  it("maps slot conflicts and blocked times to the same friendly message", () => {
    expect(mapPublicAppointmentError("slot is no longer available")).toBe(
      "Esse horário não está mais disponível. Escolha outro.",
    );
    expect(mapPublicAppointmentError("slot is blocked")).toBe(
      "Esse horário não está mais disponível. Escolha outro.",
    );
  });

  it("maps hours violations to a friendly message", () => {
    expect(mapPublicAppointmentError("closed on this day")).toBe(
      "A empresa está fechada nesse horário. Escolha outro.",
    );
    expect(mapPublicAppointmentError("outside business hours")).toBe(
      "A empresa está fechada nesse horário. Escolha outro.",
    );
  });

  it("maps notice/window violations to a friendly message", () => {
    expect(
      mapPublicAppointmentError("starts_at does not respect the minimum notice window"),
    ).toBe("Escolha uma data dentro do período permitido para agendamento.");
    expect(
      mapPublicAppointmentError("starts_at is beyond the booking window"),
    ).toBe("Escolha uma data dentro do período permitido para agendamento.");
  });

  it("never leaks the raw message for an unrecognized error", () => {
    const result = mapPublicAppointmentError("relation \"foo\" does not exist");
    expect(result).toBe("Não foi possível concluir a operação. Tente novamente.");
    expect(result).not.toContain("relation");
  });

  it("handles undefined input", () => {
    expect(mapPublicAppointmentError(undefined)).toBe(
      "Não foi possível concluir a operação. Tente novamente.",
    );
  });
});
