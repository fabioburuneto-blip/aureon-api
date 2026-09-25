import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailProvider } from "./email.ts";

const payload = {
  customer_name: "Cliente",
  service_name: "Corte",
  professional_name: "Ana",
  date_label: "25/12/2026",
  time_label: "10:00",
  business_name: "Empresa",
};

const baseInput = {
  recipient: "owner@test.com",
  event: "appointment.created" as const,
  payload,
};

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

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

describe("EmailProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok on a successful send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "email_1" })));
    const provider = new EmailProvider({ apiKey: "key", fromAddress: "no-reply@aureon.app" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: true });
  });

  it("degrades safely when the provider is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const provider = new EmailProvider({ apiKey: "key", fromAddress: "no-reply@aureon.app" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("degrades safely on a timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const provider = new EmailProvider({ apiKey: "key", fromAddress: "no-reply@aureon.app", timeoutMs: 10 });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports an invalid API key distinctly (401)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, {})));
    const provider = new EmailProvider({ apiKey: "bad-key", fromAddress: "no-reply@aureon.app" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects an obviously-malformed email before ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new EmailProvider({ apiKey: "key", fromAddress: "no-reply@aureon.app" });

    const result = await provider.send({ ...baseInput, recipient: "not-an-email" });
    expect(result).toEqual({ ok: false, reason: "invalid_recipient" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected recipient from the API distinctly (422)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(422, {})));
    const provider = new EmailProvider({ apiKey: "key", fromAddress: "no-reply@aureon.app" });

    const result = await provider.send(baseInput);
    expect(result).toEqual({ ok: false, reason: "invalid_recipient" });
  });
});
