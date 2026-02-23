import crypto from "crypto";
import express from "express";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withRequestServer } from "../helpers/request-server.js";

vi.mock("../../src/services/entity-resolution.js", () => ({
  EntityResolver: class MockEntityResolver {
    resolveAndLinkContacts = vi.fn().mockResolvedValue({
      accountId: null,
      matchMethod: "NONE",
    });
  },
  normalizeCompanyName: (s: string) => s.toLowerCase(),
  extractEmailDomain: (email: string) => email.split("@")[1] ?? null,
}));

import { createMergeWebhookHandler } from "../../src/webhooks/merge-webhook.js";

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

describe("Merge webhook tenant isolation and idempotency", () => {
  beforeEach(() => {
    process.env.MERGE_WEBHOOK_SECRET = "whsec_merge_test";
  });

  afterEach(() => {
    delete process.env.MERGE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("rejects payload when linked-account org claim mismatches stored ownership", async () => {
    const queue = { add: vi.fn() } as any;
    const prisma = {
      linkedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          organizationId: "org-real",
          status: "ACTIVE",
        }),
      },
    } as any;

    const app = express();
    app.post(
      "/api/webhooks/merge",
      express.raw({ type: "application/json" }),
      createMergeWebhookHandler({ prisma, processingQueue: queue })
    );

    const payload = JSON.stringify({
      hook: { event: "recording.created" },
      linked_account: {
        id: "la-1",
        integration: "gong",
        organization: "org-spoofed",
      },
      data: { id: "rec-1", remote_id: "remote-1", transcript: "hello world" },
    });

    const signature = signPayload(payload, process.env.MERGE_WEBHOOK_SECRET!);
    const res = await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/merge")
        .set("content-type", "application/json")
        .set("x-merge-webhook-signature", signature)
        .send(payload)
        .expect(401)
    );

    expect(res.body.error).toBe("Invalid webhook payload");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("queues call processing with stable job id for idempotency", async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined) } as any;
    const prisma = {
      linkedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          organizationId: "org-real",
          status: "ACTIVE",
        }),
      },
      call: {
        upsert: vi.fn().mockResolvedValue({ id: "call-1", accountId: null }),
      },
      callParticipant: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      transcript: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const app = express();
    app.post(
      "/api/webhooks/merge",
      express.raw({ type: "application/json" }),
      createMergeWebhookHandler({ prisma, processingQueue: queue })
    );

    const payload = JSON.stringify({
      hook: { event: "recording.created" },
      linked_account: {
        id: "la-1",
        integration: "gong",
        organization: "org-real",
      },
      data: { id: "rec-1", remote_id: "remote-1", transcript: "hello world" },
    });

    const signature = signPayload(payload, process.env.MERGE_WEBHOOK_SECRET!);
    await withRequestServer(app, (req) =>
      req
        .post("/api/webhooks/merge")
        .set("content-type", "application/json")
        .set("x-merge-webhook-signature", signature)
        .send(payload)
        .expect(200)
    );

    expect(queue.add).toHaveBeenCalledWith(
      "process-call",
      expect.objectContaining({ callId: "call-1", organizationId: "org-real" }),
      expect.objectContaining({ jobId: "process-call:call-1" })
    );
  });
});
