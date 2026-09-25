import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppProvider } from "./whatsapp.ts";

const payload = {
  customer_name: "Cliente",
  service_name: "Corte",
  professional_name: "Ana",
  date_label: "25/12/2026",
  time_label: "10:00",
  business_name: "Empresa",
};

const baseInput = {
  recipient: "+5511999999999",
  event: "appointment.created" as const,
  payload,
};

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch mock that respects AbortSignal the way a real network call
 * would -- rejects with an AbortError once the signal fires, instead of
 * ever resolving on its own. Used to simulate a hung/unresponsive
 * WhatsApp API without the test actually waiting for a real timeout. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    })) as typeof fetch;
}

describe("WhatsAppProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok on a successful send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { messages: [{ id: "wamid.1" }] })));
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: true });
  });

  it("degrades safely when the provider is unavailable (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("degrades safely on a timeout instead of hanging forever", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123", timeoutMs: 10 });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports an invalid/expired token distinctly (401)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "invalid token" })));
    const provider = new WhatsAppProvider({ accessToken: "expired", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("reports an invalid recipient distinctly (400 from the API)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "invalid phone number" })));
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "invalid_recipient" });
  });

  it("rejects an obviously-malformed phone number before ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send({ ...baseInput, recipient: "not-a-phone" });
    expect(result).toEqual({ ok: false, reason: "invalid_recipient" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports rate limiting distinctly (429)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, {})));
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("treats an unexpected 5xx as provider_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));
    const provider = new WhatsAppProvider({ accessToken: "tok", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("never leaks the access token into the returned result on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "invalid token for tok" })));
    const provider = new WhatsAppProvider({ accessToken: "super-secret-token", phoneNumberId: "123" });

    const result = await provider.send(baseInput);
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });
});
