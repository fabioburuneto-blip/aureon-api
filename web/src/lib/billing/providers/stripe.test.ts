import { describe, expect, it } from "vitest";
import { StripeProvider, mapStripeStatus } from "./stripe";
import { hmacSha256Hex } from "../crypto";

const SECRET = "test-webhook-secret";

function signedHeaders(rawBody: string, ts: number, secret = SECRET) {
  const v1 = hmacSha256Hex(secret, `${ts}.${rawBody}`);
  return new Headers({ "stripe-signature": `t=${ts},v1=${v1}` });
}

describe("StripeProvider.verifyWebhookSignature", () => {
  const provider = new StripeProvider({
    secretKey: "sk_test",
    webhookSecret: SECRET,
    priceIdByPlan: { pro: "price_pro" },
  });

  it("accepts a correctly signed, fresh event", () => {
    const rawBody = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
    const now = Math.floor(Date.now() / 1000);
    expect(provider.verifyWebhookSignature(rawBody, signedHeaders(rawBody, now))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify({ id: "evt_1" });
    const now = Math.floor(Date.now() / 1000);
    const headers = signedHeaders(rawBody, now);
    const tampered = JSON.stringify({ id: "evt_2" });
    expect(provider.verifyWebhookSignature(tampered, headers)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify({ id: "evt_1" });
    const now = Math.floor(Date.now() / 1000);
    expect(
      provider.verifyWebhookSignature(rawBody, signedHeaders(rawBody, now, "wrong-secret")),
    ).toBe(false);
  });

  it("rejects a signature whose timestamp is outside the replay tolerance", () => {
    const rawBody = JSON.stringify({ id: "evt_1" });
    const ancient = Math.floor(Date.now() / 1000) - 3600; // 1 hour old, default tolerance is 300s
    expect(provider.verifyWebhookSignature(rawBody, signedHeaders(rawBody, ancient))).toBe(false);
  });

  it("rejects a request missing the signature header", () => {
    expect(provider.verifyWebhookSignature("{}", new Headers())).toBe(false);
  });
});

describe("mapStripeStatus", () => {
  it("maps every known Stripe subscription status", () => {
    expect(mapStripeStatus("trialing")).toBe("trialing");
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete")).toBe("incomplete");
    expect(mapStripeStatus("incomplete_expired")).toBe("incomplete");
  });

  it("degrades an unknown status to incomplete instead of throwing", () => {
    expect(mapStripeStatus("some_future_status")).toBe("incomplete");
  });
});
