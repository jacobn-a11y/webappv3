import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";

function createApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "user-1";
    (req as Record<string, unknown>).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("dashboard account-access contract", () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
    },
    userAccountAccess: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([
      {
        id: "user-2",
        name: "Mia Member",
        email: "mia@example.com",
        role: "MEMBER",
      },
    ]);
    prisma.userAccountAccess.findMany.mockResolvedValue([
      {
        id: "grant-1",
        scopeType: "SINGLE_ACCOUNT",
        account: {
          id: "acc-1",
          name: "Acme",
          domain: "acme.example",
        },
        cachedAccountIds: ["acc-1"],
        crmReportId: null,
        crmProvider: null,
        crmReportName: null,
        lastSyncedAt: null,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);
  });

  it("preserves GET /api/dashboard/access response shape", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/access");

      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([
        {
          user_id: "user-2",
          user_name: "Mia Member",
          user_email: "mia@example.com",
          role: "MEMBER",
          grants: [
            {
              id: "grant-1",
              scope_type: "SINGLE_ACCOUNT",
              account: {
                id: "acc-1",
                name: "Acme",
                domain: "acme.example",
              },
              cached_account_count: 1,
              crm_report_id: null,
              crm_provider: null,
              crm_report_name: null,
              last_synced_at: null,
            },
          ],
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/access/:userId response shape", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/access/user-2");

      expect(res.status).toBe(200);
      expect(res.body.grants).toEqual([
        {
          id: "grant-1",
          scope_type: "SINGLE_ACCOUNT",
          account: {
            id: "acc-1",
            name: "Acme",
            domain: "acme.example",
          },
          cached_account_count: 1,
          crm_report_id: null,
          crm_provider: null,
          crm_report_name: null,
          last_synced_at: null,
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });
});
