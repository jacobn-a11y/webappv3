import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "crypto";
import { createMergeWebhookHandler } from "../../src/webhooks/merge-webhook.js";
import { createGongWebhookHandler } from "../../src/webhooks/gong-webhook.js";
import { createGrainWebhookHandler } from "../../src/webhooks/grain-webhook.js";
import { withRequestServer } from "../helpers/request-server.js";

function buildRawWebhookApp(path: string, handler: express.RequestHandler) {
  const app = express();
  app.post(path, express.raw({ type: "application/json" }), handler);
  return app;
}

describe("webhook signature enforcement", () => {
  afterEach(() => {
    delete process.env.MERGE_WEBHOOK_SECRET;
    delete process.env.WEBHOOK_REPLAY_WINDOW_SECONDS;
    vi.restoreAllMocks();
  });

  it("rejects Merge webhooks when MERGE_WEBHOOK_SECRET is not configured", async () => {
    const app = buildRawWebhookApp(
      "/api/webhooks/merge",
      createMergeWebhookHandler({
        prisma: {} as any,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/merge")
        .set("content-type", "application/json")
        .send(JSON.stringify({ hook: { event: "recording.created" } }))
        .expect(500)
    );

    expect(res.body.error).toBe("MERGE_WEBHOOK_SECRET is not configured");
  });

  it("rejects Gong webhooks when any active config has no webhookSecret", async () => {
    const prisma = {
      integrationConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "GONG",
            enabled: true,
            status: "ACTIVE",
            webhookSecret: null,
            credentials: {},
            organizationId: "org-1",
          },
        ]),
      },
    } as any;

    const app = buildRawWebhookApp(
      "/api/webhooks/gong",
      createGongWebhookHandler({
        prisma,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/gong")
        .set("content-type", "application/json")
        .send(JSON.stringify({ event: "CALL_RECORDING_READY", callId: "call-1" }))
        .expect(500)
    );

    expect(res.body.error).toBe(
      "All active Gong integrations must configure webhookSecret"
    );
  });

  it("rejects Grain webhooks when any active config has no webhookSecret", async () => {
    const prisma = {
      integrationConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "GRAIN",
            enabled: true,
            status: "ACTIVE",
            webhookSecret: null,
            credentials: {},
            organizationId: "org-1",
          },
        ]),
      },
    } as any;

    const app = buildRawWebhookApp(
      "/api/webhooks/grain",
      createGrainWebhookHandler({
        prisma,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/grain")
        .set("content-type", "application/json")
        .send(JSON.stringify({ event: "recording.completed", recording_id: "rec-1" }))
        .expect(500)
    );

    expect(res.body.error).toBe(
      "All active Grain integrations must configure webhookSecret"
    );
  });

  it("rejects Merge webhooks with stale timestamps even when signature is valid", async () => {
    process.env.MERGE_WEBHOOK_SECRET = "merge-secret";
    process.env.WEBHOOK_REPLAY_WINDOW_SECONDS = "60";

    const payload = JSON.stringify({
      hook: {
        event: "recording.created",
        timestamp: "2020-01-01T00:00:00.000Z",
      },
      linked_account: {
        id: "linked-1",
        integration: "gong",
      },
      data: { id: "rec-1" },
    });
    const signature = crypto
      .createHmac("sha256", process.env.MERGE_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const app = buildRawWebhookApp(
      "/api/webhooks/merge",
      createMergeWebhookHandler({
        prisma: {
          linkedAccount: { findUnique: vi.fn() },
        } as any,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/merge")
        .set("content-type", "application/json")
        .set("x-merge-webhook-signature", signature)
        .send(payload)
        .expect(401)
    );

    expect(res.body.error).toBe("stale_webhook");
  });

  it("rejects Gong webhooks with stale timestamps even when signature is valid", async () => {
    const webhookSecret = "gong-secret";
    process.env.WEBHOOK_REPLAY_WINDOW_SECONDS = "60";
    const payload = JSON.stringify({
      event: "CALL_RECORDING_READY",
      callId: "call-1",
    });
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");

    const prisma = {
      integrationConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "GONG",
            enabled: true,
            status: "ACTIVE",
            webhookSecret,
            credentials: {},
            organizationId: "org-1",
          },
        ]),
      },
    } as any;

    const app = buildRawWebhookApp(
      "/api/webhooks/gong",
      createGongWebhookHandler({
        prisma,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/gong")
        .set("content-type", "application/json")
        .set("x-gong-signature", signature)
        .set("x-gong-timestamp", "2020-01-01T00:00:00.000Z")
        .send(payload)
        .expect(401)
    );

    expect(res.body.error).toBe("stale_webhook");
  });

  it("rejects Grain webhooks with stale timestamps even when signature is valid", async () => {
    const webhookSecret = "grain-secret";
    process.env.WEBHOOK_REPLAY_WINDOW_SECONDS = "60";
    const payload = JSON.stringify({
      event: "recording.completed",
      recording_id: "rec-1",
      timestamp: "2020-01-01T00:00:00.000Z",
    });
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");

    const prisma = {
      integrationConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "GRAIN",
            enabled: true,
            status: "ACTIVE",
            webhookSecret,
            credentials: {},
            organizationId: "org-1",
          },
        ]),
      },
    } as any;

    const app = buildRawWebhookApp(
      "/api/webhooks/grain",
      createGrainWebhookHandler({
        prisma,
        processingQueue: { add: vi.fn() } as any,
      })
    );

    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/grain")
        .set("content-type", "application/json")
        .set("x-grain-signature", signature)
        .send(payload)
        .expect(401)
    );

    expect(res.body.error).toBe("stale_webhook");
  });
});
