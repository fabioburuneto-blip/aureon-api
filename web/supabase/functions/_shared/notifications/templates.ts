import type {
  NotificationEventType,
  NotificationMessage,
  NotificationPayload,
} from "./types.ts";

/**
 * One place for every outbound message. WhatsApp templates follow the
 * exact format requested for "novo agendamento"; cancelamento/reagendamento
 * mirror the same shape. Email reuses the same body as plain text -- there
 * is no HTML template yet, matching the "email quando configurado" scope
 * (a bare-bones channel, not a marketing email system).
 */
export function renderMessage(
  event: NotificationEventType,
  payload: NotificationPayload,
): NotificationMessage {
  const p = payload;

  switch (event) {
    case "appointment.created":
      return {
        title: "Novo agendamento",
        body:
          `🔔 Novo agendamento\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Profissional: ${p.professional_name}\n` +
          `Data: ${p.date_label}\n` +
          `Horário: ${p.time_label}`,
      };
    case "appointment.cancelled":
      return {
        title: "Agendamento cancelado",
        body:
          `❌ Agendamento cancelado\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Profissional: ${p.professional_name}\n` +
          `Data: ${p.date_label}\n` +
          `Horário: ${p.time_label}`,
      };
    case "appointment.rescheduled":
      return {
        title: "Agendamento reagendado",
        body:
          `🔄 Agendamento reagendado\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Profissional: ${p.professional_name}\n` +
          `Nova data: ${p.date_label}\n` +
          `Novo horário: ${p.time_label}`,
      };
    case "appointment.reminder_24h":
      return {
        title: "Lembrete: agendamento amanhã",
        body:
          `⏰ Lembrete: agendamento amanhã\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Profissional: ${p.professional_name}\n` +
          `Data: ${p.date_label}\n` +
          `Horário: ${p.time_label}`,
      };
    case "appointment.reminder_2h":
      return {
        title: "Lembrete: agendamento em 2 horas",
        body:
          `⏰ Lembrete: agendamento em 2 horas\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Profissional: ${p.professional_name}\n` +
          `Horário: ${p.time_label}`,
      };
    case "appointment.confirmed":
      return {
        title: "Agendamento confirmado",
        body:
          `✅ Agendamento confirmado\n` +
          `Cliente: ${p.customer_name}\n` +
          `Serviço: ${p.service_name}\n` +
          `Data: ${p.date_label}\n` +
          `Horário: ${p.time_label}`,
      };
    case "appointment.completed":
      return {
        title: "Atendimento concluído",
        body: `Atendimento de ${p.service_name} com ${p.customer_name} concluído.`,
      };
    case "appointment.no_show":
      return {
        title: "Cliente não compareceu",
        body: `${p.customer_name} não compareceu ao agendamento de ${p.service_name}.`,
      };
  }
}
