/**
 * Maps a raw Postgres error message from get_public_appointment()/
 * cancel_public_appointment()/reschedule_public_appointment() to a
 * friendly, Portuguese message safe to show a customer -- never a stack
 * trace, SQL, or an internal RPC/function name. Matched by message
 * substring (not error code alone) because several distinct rules
 * deliberately share the same Postgres errcode (P0001, "business rule
 * violation") the same way validate_appointment_slot() already does for
 * "closed on this day"/"outside business hours"/"slot is blocked".
 *
 * Every unmatched/unexpected error falls through to one generic message
 * -- callers never need their own fallback text.
 */
export function mapPublicAppointmentError(message: string | undefined): string {
  const m = message ?? "";

  if (m.includes("appointment not found")) {
    return "Este link de agendamento não é válido ou expirou.";
  }
  if (m.includes("cancellation window has passed")) {
    return "O prazo para cancelar este agendamento já passou.";
  }
  if (m.includes("reschedule window has passed")) {
    return "O prazo para reagendar este agendamento já passou.";
  }
  if (
    m.includes("can no longer be cancelled") ||
    m.includes("can no longer be rescheduled")
  ) {
    return "Este agendamento não pode mais ser alterado.";
  }
  if (m.includes("no longer available") || m.includes("slot is blocked")) {
    return "Esse horário não está mais disponível. Escolha outro.";
  }
  if (m.includes("closed on this day") || m.includes("outside business hours")) {
    return "A empresa está fechada nesse horário. Escolha outro.";
  }
  if (
    m.includes("minimum notice window") ||
    m.includes("beyond the booking window")
  ) {
    return "Escolha uma data dentro do período permitido para agendamento.";
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}
