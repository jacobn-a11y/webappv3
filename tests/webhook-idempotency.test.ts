import { describe, expect, it, vi } from "vitest";
import { markWebhookEventIfNew } from "../src/lib/webhook-idempotency.js";

describe("webhook idempotency guard", () => {
  it("accepts first delivery and rejects duplicates within ttl", () => {
    const key = `merge:org_1:recording.created:rec_1:${Date.now()}`;
    expect(markWebhookEventIfNew(key, 10_000)).toBe(true);
    expect(markWebhookEventIfNew(key, 10_000)).toBe(false);
  });

  it("allows replay after ttl expires", () => {
    vi.useFakeTimers();
    const key = `gong:org_1:CALL_TRANSCRIPT_READY:call_1:${Date.now()}`;
    expect(markWebhookEventIfNew(key, 1000)).toBe(true);
    expect(markWebhookEventIfNew(key, 1000)).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(markWebhookEventIfNew(key, 1000)).toBe(true);
    vi.useRealTimers();
  });
});
