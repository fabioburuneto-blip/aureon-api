import { describe, expect, it, vi } from "vitest";
import { applyBillingWebhookEvent } from "./apply-event";
import type { BillingWebhookEvent } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function baseEvent(overrides: Partial<BillingWebhookEvent> = {}): BillingWebhookEvent {
  return {
    id: "evt_1",
    type: "subscription.updated",
    providerSubscriptionId: "sub_123",
    providerCustomerId: "cus_123",
    businessId: null,
    status: "active",
    planId: "pro",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

type UpdateResult = { data: { id: string }[] | null; error: { message: string } | null };

function createFakeSupabase(options: {
  insertError?: { code: string; message: string } | null;
  updateResults?: UpdateResult[];
}) {
  const insertMock = vi.fn(async () => ({ error: options.insertError ?? null }));
  let updateCallIndex = 0;
  const updateResults = options.updateResults ?? [];

  const subscriptionsUpdateMock = vi.fn((update: Record<string, unknown>) => {
    void update; // captured via subscriptionsUpdateMock.mock.calls, not used here
    return {
      eq: vi.fn(() => ({
        select: vi.fn(async () => {
          const result = updateResults[updateCallIndex] ?? { data: [], error: null };
          updateCallIndex += 1;
          return result;
        }),
      })),
    };
  });

  const from = vi.fn((table: string) => {
    if (table === "billing_webhook_events") {
      return { insert: insertMock };
    }
    if (table === "subscriptions") {
      return { update: subscriptionsUpdateMock };
    }
    throw new Error(`unexpected table in test: ${table}`);
  });

  const supabase = { from } as unknown as SupabaseClient<Database>;
  return { supabase, insertMock, subscriptionsUpdateMock };
}

describe("applyBillingWebhookEvent", () => {
  it("is idempotent: a duplicate event id never touches subscriptions", async () => {
    const { supabase, subscriptionsUpdateMock } = createFakeSupabase({
      insertError: { code: "23505", message: "duplicate key" },
    });

    const outcome = await applyBillingWebhookEvent(supabase, "stripe", baseEvent());

    expect(outcome).toBe("duplicate");
    expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
  });

  it("applies the update when matched by provider_subscription_id on the first try", async () => {
    const { supabase, subscriptionsUpdateMock } = createFakeSupabase({
      updateResults: [{ data: [{ id: "row-1" }], error: null }],
    });

    const outcome = await applyBillingWebhookEvent(supabase, "stripe", baseEvent());

    expect(outcome).toBe("applied");
    expect(subscriptionsUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to matching by business_id when provider_subscription_id isn't linked yet", async () => {
    const { supabase, subscriptionsUpdateMock } = createFakeSupabase({
      updateResults: [
        { data: [], error: null }, // no row yet has this provider_subscription_id
        { data: [{ id: "row-1" }], error: null }, // matched by business_id instead
      ],
    });

    const outcome = await applyBillingWebhookEvent(
      supabase,
      "stripe",
      baseEvent({ businessId: "biz-1" }),
    );

    expect(outcome).toBe("applied");
    expect(subscriptionsUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("reports unmatched instead of throwing when no row and no business_id fallback exist", async () => {
    const { supabase } = createFakeSupabase({
      updateResults: [{ data: [], error: null }],
    });

    const outcome = await applyBillingWebhookEvent(
      supabase,
      "stripe",
      baseEvent({ businessId: null }),
    );

    expect(outcome).toBe("unmatched");
  });

  it("reports unmatched without writing anything when the event carries no subscription id", async () => {
    const { supabase, subscriptionsUpdateMock } = createFakeSupabase({});

    const outcome = await applyBillingWebhookEvent(
      supabase,
      "stripe",
      baseEvent({ providerSubscriptionId: null }),
    );

    expect(outcome).toBe("unmatched");
    expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
  });

  it("throws on a genuine (non-duplicate) idempotency insert failure instead of silently proceeding", async () => {
    const { supabase } = createFakeSupabase({
      insertError: { code: "08006", message: "connection failure" },
    });

    await expect(applyBillingWebhookEvent(supabase, "stripe", baseEvent())).rejects.toThrow();
  });

  it("never writes an unrecognized plan_id, even if the provider adapter sends one", async () => {
    const { supabase, subscriptionsUpdateMock } = createFakeSupabase({
      updateResults: [{ data: [{ id: "row-1" }], error: null }],
    });

    await applyBillingWebhookEvent(
      supabase,
      "stripe",
      baseEvent({ planId: "some-plan-that-does-not-exist" }),
    );

    const [update] = subscriptionsUpdateMock.mock.calls[0];
    expect(update).not.toHaveProperty("plan_id");
  });
});
