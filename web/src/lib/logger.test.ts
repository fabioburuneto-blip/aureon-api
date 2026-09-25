import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logError } from "./logger";

describe("logError", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  function loggedPayload(): Record<string, unknown> {
    const raw = spy.mock.calls[0]?.[0];
    return JSON.parse(raw as string);
  }

  it("includes the event name and context", () => {
    logError("appointment.create_failed", { business_id: "b1", appointment_id: "a1" });
    const payload = loggedPayload();
    expect(payload.event).toBe("appointment.create_failed");
    expect(payload.business_id).toBe("b1");
    expect(payload.appointment_id).toBe("a1");
  });

  it("captures message and code from a Postgres/PostgREST-shaped error", () => {
    logError("service.update_failed", { business_id: "b1" }, {
      message: "duplicate key value violates unique constraint",
      code: "23505",
      details: "Key (business_id, phone)=(b1, +5511999999999) already exists.",
      hint: "some hint",
    });
    const payload = loggedPayload();
    expect(payload.error_message).toBe("duplicate key value violates unique constraint");
    expect(payload.error_code).toBe("23505");
  });

  it("never surfaces details/hint, which can embed raw customer data", () => {
    logError("customers.create_failed", {}, {
      message: "duplicate key value violates unique constraint",
      code: "23505",
      details: "Key (business_id, phone)=(b1, +5511999999999) already exists.",
      hint: "a hint",
    });
    const raw = spy.mock.calls[0]?.[0] as string;
    expect(raw).not.toContain("+5511999999999");
    expect(raw).not.toContain("details");
    expect(raw).not.toContain("hint");
  });

  it("handles a plain Error instance", () => {
    logError("webhook.processing_failed", { provider: "stripe" }, new Error("boom"));
    const payload = loggedPayload();
    expect(payload.error_message).toBe("boom");
  });

  it("handles a plain string error", () => {
    logError("x", {}, "raw string error");
    expect(loggedPayload().error_message).toBe("raw string error");
  });

  it("handles no error at all", () => {
    logError("y", {});
    expect(loggedPayload().error_message).toBeUndefined();
  });
});
