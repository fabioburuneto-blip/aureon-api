import { describe, expect, it } from "vitest";
import { MercadoPagoProvider, mapMercadoPagoStatus } from "./mercadopago";
import { hmacSha256Hex } from "../crypto";

const SECRET = "test-webhook-secret";

function signedHeaders(dataId: string, requestId: string, ts: string, secret = SECRET) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = hmacSha256Hex(secret, manifest);
  return new Headers({
    "x-signature": `ts=${ts},v1=${v1}`,
    "x-request-id": requestId,
  });
}

describe("MercadoPagoProvider.verifyWebhookSignature", () => {
  const provider = new MercadoPagoProvider({ accessToken: "tok", webhookSecret: SECRET });

  it("accepts a correctly signed notification", () => {
    const rawBody = JSON.stringify({ data: { id: "123456" } });
    const headers = signedHeaders("123456", "req-1", "1700000000");
    expect(provider.verifyWebhookSignature(rawBody, headers)).toBe(true);
  });

  it("rejects a tampered body (data.id changed after signing)", () => {
    const headers = signedHeaders("123456", "req-1", "1700000000");
    const tamperedBody = JSON.stringify({ data: { id: "999999" } });
    expect(provider.verifyWebhookSignature(tamperedBody, headers)).toBe(false);
  });

  it("rejects a signature produced with the wrong secret", () => {
    const rawBody = JSON.stringify({ data: { id: "123456" } });
    const headers = signedHeaders("123456", "req-1", "1700000000", "wrong-secret");
    expect(provider.verifyWebhookSignature(rawBody, headers)).toBe(false);
  });

  it("rejects a request missing the signature header entirely", () => {
    const rawBody = JSON.stringify({ data: { id: "123456" } });
    expect(provider.verifyWebhookSignature(rawBody, new Headers())).toBe(false);
  });

  it("rejects a body that isn't valid JSON instead of throwing", () => {
    const headers = signedHeaders("123456", "req-1", "1700000000");
    expect(provider.verifyWebhookSignature("not json", headers)).toBe(false);
  });
});

describe("mapMercadoPagoStatus", () => {
  it("maps every known preapproval status", () => {
    expect(mapMercadoPagoStatus("authorized")).toBe("active");
    expect(mapMercadoPagoStatus("paused")).toBe("past_due");
    expect(mapMercadoPagoStatus("cancelled")).toBe("canceled");
    expect(mapMercadoPagoStatus("pending")).toBe("incomplete");
  });

  it("degrades an unknown status to incomplete instead of throwing", () => {
    expect(mapMercadoPagoStatus("some_future_status")).toBe("incomplete");
  });
});
