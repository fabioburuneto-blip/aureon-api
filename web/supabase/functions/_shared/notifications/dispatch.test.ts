import { describe, expect, it } from "vitest";
import { dispatchDelivery } from "./dispatch.ts";
import type { NotificationProvider, SendResult } from "./types.ts";

const payload = {
  customer_name: "Cliente",
  service_name: "Corte",
  professional_name: "Ana",
  date_label: "25/12/2026",
  time_label: "10:00",
  business_name: "Empresa",
};

function fakeProvider(result: SendResult | (() => Promise<SendResult>)): NotificationProvider {
  return {
    channel: "whatsapp",
    send: async () => (typeof result === "function" ? result() : result),
  };
}

describe("dispatchDelivery", () => {
  it("degrades safely when the requested channel has no configured provider", async () => {
    const outcome = await dispatchDelivery(
      {},
      { channel: "whatsapp", recipient: "+5511999999999", event: "appointment.created", payload, attempts: 0 },
    );
    expect(outcome.status).toBe("retrying");
    expect(outcome.lastError).toBe("provider_unavailable");
  });

  it("records a successful send", async () => {
    const outcome = await dispatchDelivery(
      { whatsapp: fakeProvider({ ok: true }) },
      { channel: "whatsapp", recipient: "+5511999999999", event: "appointment.created", payload, attempts: 0 },
    );
    expect(outcome.status).toBe("sent");
  });

  it("never throws when the provider itself throws unexpectedly -- degrades to provider_unavailable", async () => {
    const provider = fakeProvider(() => {
      throw new Error("boom");
    });

    await expect(
      dispatchDelivery(
        { whatsapp: provider },
        { channel: "whatsapp", recipient: "+5511999999999", event: "appointment.created", payload, attempts: 0 },
      ),
    ).resolves.toMatchObject({ status: "retrying", lastError: "provider_unavailable" });
  });

  it("never throws when the provider returns a rejected promise", async () => {
    const provider: NotificationProvider = {
      channel: "email",
      send: () => Promise.reject(new Error("network down")),
    };

    const outcome = await dispatchDelivery(
      { email: provider },
      { channel: "email", recipient: "owner@test.com", event: "appointment.created", payload, attempts: 0 },
    );
    expect(outcome.status).toBe("retrying");
    expect(outcome.lastError).toBe("provider_unavailable");
  });
});
