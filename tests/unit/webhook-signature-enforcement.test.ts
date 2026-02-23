import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
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
});
