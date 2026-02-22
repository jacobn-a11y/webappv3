import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createIntegrationRoutes } from "../src/api/integration-routes.js";
import { createApiKeyRoutes } from "../src/api/api-key-routes.js";

function createIntegrationApp(prisma: any, organizationId = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = organizationId;
    next();
  });

  const registry = {
    callRecording: new Map(),
    crm: new Map(),
  } as any;
  const syncEngine = {
    runSyncForProvider: vi.fn(),
  } as any;

  app.use("/api/integrations", createIntegrationRoutes(prisma, registry, syncEngine));
  return app;
}

function createApiKeysApp(prisma: any, organizationId = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = organizationId;
    next();
  });
  app.use("/api/keys", createApiKeyRoutes(prisma));
  return app;
}

describe("Tenant isolation on critical routes", () => {
  const prisma = {
    orgSettings: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    integrationConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    apiKey: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
  });

  it("scopes integration updates by organization + provider", async () => {
    prisma.integrationConfig.findUnique.mockResolvedValue({
      id: "cfg-other-tenant",
      organizationId: "org-b",
      provider: "GONG",
      credentials: {},
    });
    prisma.integrationConfig.update.mockResolvedValue({
      id: "cfg-other-tenant",
      provider: "GONG",
      enabled: true,
      status: "ACTIVE",
    });

    const app = createIntegrationApp(prisma, "org-a");
    const res = await request(app)
      .patch("/api/integrations/gong")
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(prisma.integrationConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_provider: {
            organizationId: "org-a",
            provider: "GONG",
          },
        },
      })
    );
  });

  it("scopes API key revoke updates by organization + key id", async () => {
    prisma.apiKey.findFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-a",
      revokedAt: null,
    });
    prisma.apiKey.updateMany.mockResolvedValue({ count: 1 });

    const app = createApiKeysApp(prisma, "org-a");
    const res = await request(app).delete("/api/keys/key-1");

    expect(res.status).toBe(200);
    expect(prisma.apiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1", organizationId: "org-a" },
      })
    );
  });
});
