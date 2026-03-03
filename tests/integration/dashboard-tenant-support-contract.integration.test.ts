import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";

function createApp(prisma: any, userRole: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "user-1";
    (req as Record<string, unknown>).userRole = userRole;
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("dashboard tenant support contract", () => {
  const prisma = {
    platformSettings: {
      findFirst: vi.fn(),
    },
    tenantSupportOptOut: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    tenantDeletionRequest: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.platformSettings.findFirst.mockResolvedValue(null);
    prisma.tenantSupportOptOut.findUnique.mockResolvedValue(null);
    prisma.tenantDeletionRequest.findUnique.mockResolvedValue(null);
  });

  it("preserves GET /api/dashboard/support-account contract", async () => {
    const app = createApp(prisma, "MEMBER");
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/support-account");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        email: null,
        label: "Platform Support",
        opted_out: false,
      });
    } finally {
      close();
    }
  });

  it("preserves opt-out authorization behavior", async () => {
    const app = createApp(prisma, "MEMBER");
    const { request, close } = await requestServer(app);
    try {
      const res = await request.post("/api/dashboard/support-account/opt-out");

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only account owner or admin");
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/account/deletion-status no-request contract", async () => {
    const app = createApp(prisma, "OWNER");
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/account/deletion-status");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        has_request: false,
        status: null,
        scheduled_delete_at: null,
        created_at: null,
      });
    } finally {
      close();
    }
  });
});
