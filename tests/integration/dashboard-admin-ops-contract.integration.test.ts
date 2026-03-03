import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";

function createApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "admin-1";
    (req as Record<string, unknown>).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("dashboard admin ops contract", () => {
  const prisma = {
    scimProvisioning: {
      findUnique: vi.fn(),
    },
    scimIdentity: {
      count: vi.fn(),
    },
    orgFeatureFlag: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.scimProvisioning.findUnique.mockResolvedValue(null);
    prisma.scimIdentity.count.mockResolvedValue(0);
    prisma.orgFeatureFlag.findMany.mockResolvedValue([]);
  });

  it("preserves GET /api/dashboard/scim-provisioning defaults", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/scim-provisioning");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: false,
        endpoint_secret_hint: null,
        last_sync_at: null,
        identities_count: 0,
      });
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/feature-flags mapping contract", async () => {
    prisma.orgFeatureFlag.findMany.mockResolvedValue([
      {
        id: "ff-1",
        key: "ops_dashboard",
        enabled: true,
        config: { beta: true },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/feature-flags");

      expect(res.status).toBe(200);
      expect(res.body.flags).toEqual([
        {
          id: "ff-1",
          key: "ops_dashboard",
          enabled: true,
          resolved_enabled: true,
          override_source: null,
          config: { beta: true },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/feature-flags/resolved shape", async () => {
    prisma.orgFeatureFlag.findMany.mockResolvedValue([
      {
        id: "ff-1",
        key: "ops_dashboard",
        enabled: true,
        config: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "ff-2",
        key: "disabled_flag",
        enabled: false,
        config: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/feature-flags/resolved");

      expect(res.status).toBe(200);
      expect(typeof res.body.environment).toBe("string");
      expect(res.body.enabled_feature_flags).toEqual(["ops_dashboard"]);
    } finally {
      close();
    }
  });
});
