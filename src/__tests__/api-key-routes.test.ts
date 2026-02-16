/**
 * Tests for API Key Management Routes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createApiKeyRoutes } from "../api/api-key-routes.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());

  // Simulate authenticated admin user
  app.use((req: any, _res, next) => {
    req.organizationId = "org_test";
    req.userId = "user_test";
    next();
  });

  app.use("/api/keys", createApiKeyRoutes(prisma));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("API Key Routes", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      apiKey: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        $transaction: vi.fn(),
      },
      apiUsageLog: {
        count: vi.fn(),
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };
  });

  describe("POST /api/keys", () => {
    it("creates a new API key and returns the raw key", async () => {
      prisma.apiKey.create.mockImplementation(async ({ data }: any) => ({
        id: "key_new",
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        label: data.label,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      }));

      const app = buildApp(prisma);
      const res = await request(app)
        .post("/api/keys")
        .send({ label: "My Chatbot" });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^se_live_/);
      expect(res.body.label).toBe("My Chatbot");
      expect(res.body.scopes).toEqual(["rag:query"]);
      expect(res.body.id).toBe("key_new");
    });

    it("rejects missing label", async () => {
      const app = buildApp(prisma);
      const res = await request(app).post("/api/keys").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("accepts custom scopes and expiration", async () => {
      prisma.apiKey.create.mockImplementation(async ({ data }: any) => ({
        id: "key_custom",
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        label: data.label,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      }));

      const app = buildApp(prisma);
      const res = await request(app).post("/api/keys").send({
        label: "Expiring Key",
        scopes: ["rag:query", "stories:read"],
        expires_in_days: 30,
      });

      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(["rag:query", "stories:read"]);
      expect(res.body.expires_at).toBeTruthy();
    });
  });

  describe("GET /api/keys", () => {
    it("lists all keys for the organization", async () => {
      prisma.apiKey.findMany.mockResolvedValue([
        {
          id: "key_1",
          keyPrefix: "se_live_abc1",
          label: "Bot A",
          scopes: ["rag:query"],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: new Date(),
          replacedByKeyId: null,
          gracePeriodEndsAt: null,
          createdAt: new Date(),
        },
        {
          id: "key_2",
          keyPrefix: "se_live_def2",
          label: "Bot B",
          scopes: ["rag:query"],
          expiresAt: null,
          revokedAt: new Date(),
          lastUsedAt: null,
          replacedByKeyId: "key_3",
          gracePeriodEndsAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
        },
      ]);

      const app = buildApp(prisma);
      const res = await request(app).get("/api/keys");

      expect(res.status).toBe(200);
      expect(res.body.keys).toHaveLength(2);
      expect(res.body.keys[0].status).toBe("active");
      expect(res.body.keys[1].status).toBe("rotating");
    });
  });

  describe("POST /api/keys/:keyId/rotate", () => {
    it("creates a new key and revokes the old one with grace period", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: "key_old",
        organizationId: "org_test",
        label: "My Bot",
        scopes: ["rag:query"],
        expiresAt: null,
        revokedAt: null,
      });

      const newKeyRecord = {
        id: "key_new",
        keyPrefix: "se_live_newk",
        label: "My Bot",
        scopes: ["rag:query"],
        expiresAt: null,
        createdAt: new Date(),
      };

      prisma.$transaction.mockResolvedValue([newKeyRecord, {}]);
      prisma.apiKey.update.mockResolvedValue({});

      const app = buildApp(prisma);
      const res = await request(app)
        .post("/api/keys/key_old/rotate")
        .send({ grace_period_hours: 48 });

      expect(res.status).toBe(201);
      expect(res.body.new_key.key).toMatch(/^se_live_/);
      expect(res.body.new_key.label).toBe("My Bot");
      expect(res.body.old_key.id).toBe("key_old");
      expect(res.body.old_key.grace_period_ends_at).toBeTruthy();
      expect(res.body.message).toContain("Old key will continue to work");
    });

    it("rejects rotation of already-revoked key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: "key_revoked",
        organizationId: "org_test",
        revokedAt: new Date(),
      });

      const app = buildApp(prisma);
      const res = await request(app)
        .post("/api/keys/key_revoked/rotate")
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("key_already_revoked");
    });

    it("returns 404 for non-existent key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      const app = buildApp(prisma);
      const res = await request(app)
        .post("/api/keys/nonexistent/rotate")
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/keys/:keyId", () => {
    it("revokes an active key immediately", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: "key_to_revoke",
        organizationId: "org_test",
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});

      const app = buildApp(prisma);
      const res = await request(app).delete("/api/keys/key_to_revoke");

      expect(res.status).toBe(200);
      expect(res.body.revoked).toBe(true);
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: "key_to_revoke" },
        data: { revokedAt: expect.any(Date), gracePeriodEndsAt: null },
      });
    });

    it("rejects revoking an already-revoked key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: "key_already",
        organizationId: "org_test",
        revokedAt: new Date(),
      });

      const app = buildApp(prisma);
      const res = await request(app).delete("/api/keys/key_already");

      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/keys/:keyId/usage", () => {
    it("returns usage statistics for a key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: "key_usage",
        keyPrefix: "se_live_usag",
        label: "Usage Bot",
      });
      prisma.apiUsageLog.count.mockResolvedValue(250);
      prisma.apiUsageLog.aggregate.mockResolvedValue({
        _sum: { tokensUsed: 12500 },
      });
      prisma.apiUsageLog.findMany.mockResolvedValue([
        {
          endpoint: "/api/v1/rag/query",
          method: "POST",
          statusCode: 200,
          tokensUsed: 100,
          responseTimeMs: 350,
          createdAt: new Date(),
        },
      ]);

      const app = buildApp(prisma);
      const res = await request(app).get("/api/keys/key_usage/usage");

      expect(res.status).toBe(200);
      expect(res.body.total_requests).toBe(250);
      expect(res.body.total_tokens_used).toBe(12500);
      expect(res.body.recent_logs).toHaveLength(1);
    });

    it("returns 404 for non-existent key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      const app = buildApp(prisma);
      const res = await request(app).get("/api/keys/nonexistent/usage");

      expect(res.status).toBe(404);
    });
  });
});
