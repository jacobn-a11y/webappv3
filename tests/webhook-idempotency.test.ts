import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markWebhookEventIfNew } from "../src/lib/webhook-idempotency.js";

describe("webhook idempotency guard", () => {
  const origRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (origRedisUrl !== undefined) process.env.REDIS_URL = origRedisUrl;
    else delete process.env.REDIS_URL;
  });

  it("accepts first delivery and rejects duplicates within ttl", async () => {
    const key = `merge:org_1:recording.created:rec_1:${Date.now()}`;
    expect(await markWebhookEventIfNew(key, 10_000)).toBe(true);
    expect(await markWebhookEventIfNew(key, 10_000)).toBe(false);
  });

  it("allows replay after ttl expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = `gong:org_1:CALL_TRANSCRIPT_READY:call_1:${Date.now()}`;
    expect(await markWebhookEventIfNew(key, 1000)).toBe(true);
    expect(await markWebhookEventIfNew(key, 1000)).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(await markWebhookEventIfNew(key, 1000)).toBe(true);
    vi.useRealTimers();
  });
});
