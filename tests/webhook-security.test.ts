import { afterEach, describe, expect, it } from "vitest";
import {
  pickFirstHeaderValue,
  validateWebhookTimestamp,
} from "../src/lib/webhook-security.js";

describe("webhook security helpers", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_REPLAY_WINDOW_SECONDS;
  });

  it("accepts timestamps inside replay window", () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const result = validateWebhookTimestamp({
      provider: "grain",
      timestamp: "2026-02-24T11:58:00.000Z",
      required: true,
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("rejects stale timestamps", () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const result = validateWebhookTimestamp({
      provider: "grain",
      timestamp: "2026-02-24T11:40:00.000Z",
      required: true,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_window");
  });

  it("rejects invalid timestamp values", () => {
    const result = validateWebhookTimestamp({
      provider: "grain",
      timestamp: "not-a-valid-timestamp",
      required: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timestamp_invalid");
  });

  it("rejects missing required timestamps", () => {
    const result = validateWebhookTimestamp({
      provider: "grain",
      timestamp: null,
      required: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timestamp_missing");
  });

  it("allows missing optional timestamps", () => {
    const result = validateWebhookTimestamp({
      provider: "merge",
      timestamp: null,
      required: false,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts numeric unix-second timestamps inside replay window", () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const result = validateWebhookTimestamp({
      provider: "merge",
      timestamp: String(Math.floor(new Date("2026-02-24T11:59:30.000Z").getTime() / 1000)),
      required: false,
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("honors WEBHOOK_REPLAY_WINDOW_SECONDS override", () => {
    process.env.WEBHOOK_REPLAY_WINDOW_SECONDS = "900";
    const now = new Date("2026-02-24T12:00:00.000Z");
    const result = validateWebhookTimestamp({
      provider: "merge",
      timestamp: "2026-02-24T11:50:10.000Z",
      required: false,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects future timestamps outside replay window", () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const result = validateWebhookTimestamp({
      provider: "merge",
      timestamp: "2026-02-24T12:20:00.000Z",
      required: false,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_window");
  });

  it("selects the first present header value", () => {
    const value = pickFirstHeaderValue(
      {
        "x-webhook-timestamp": "1700000",
        "x-request-timestamp": ["1700001"],
      },
      ["x-merge-webhook-timestamp", "x-webhook-timestamp", "x-request-timestamp"]
    );
    expect(value).toBe("1700000");
  });
});
