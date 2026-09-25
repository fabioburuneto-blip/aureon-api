import { describe, expect, it } from "vitest";
import { AsaasProvider, mapAsaasEventToStatus } from "./asaas";

describe("AsaasProvider.verifyWebhookSignature", () => {
  const provider = new AsaasProvider({ apiKey: "key", webhookToken: "shared-secret-token" });

  it("accepts a request carrying the matching access token", () => {
    const headers = new Headers({ "asaas-access-token": "shared-secret-token" });
    expect(provider.verifyWebhookSignature("{}", headers)).toBe(true);
  });

  it("rejects a request with the wrong token", () => {
    const headers = new Headers({ "asaas-access-token": "guessed-token" });
    expect(provider.verifyWebhookSignature("{}", headers)).toBe(false);
  });

  it("rejects a request missing the token header", () => {
    expect(provider.verifyWebhookSignature("{}", new Headers())).toBe(false);
  });
});

describe("AsaasProvider.parseWebhookEvent", () => {
  const provider = new AsaasProvider({ apiKey: "key", webhookToken: "shared-secret-token" });

  it("parses a subscription payment event", async () => {
    const rawBody = JSON.stringify({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      payment: { subscription: "sub_123", customer: "cus_1" },
    });
    const event = await provider.parseWebhookEvent(rawBody);
    expect(event).toMatchObject({
      providerSubscriptionId: "sub_123",
      providerCustomerId: "cus_1",
      status: "active",
    });
  });

  it("returns null for an event type the app doesn't act on", async () => {
    const rawBody = JSON.stringify({ id: "evt_1", event: "SOME_OTHER_EVENT" });
    expect(await provider.parseWebhookEvent(rawBody)).toBeNull();
  });

  it("returns null instead of throwing on malformed JSON", async () => {
    expect(await provider.parseWebhookEvent("not json")).toBeNull();
  });
});

describe("mapAsaasEventToStatus", () => {
  it("maps known events", () => {
    expect(mapAsaasEventToStatus("PAYMENT_CONFIRMED")).toBe("active");
    expect(mapAsaasEventToStatus("PAYMENT_OVERDUE")).toBe("past_due");
    expect(mapAsaasEventToStatus("SUBSCRIPTION_DELETED")).toBe("canceled");
  });

  it("returns null (not a guess) for an unmapped event", () => {
    expect(mapAsaasEventToStatus("SOMETHING_NEW")).toBeNull();
  });
});
