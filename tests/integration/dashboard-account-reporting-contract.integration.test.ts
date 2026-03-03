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

describe("dashboard account reporting contract", () => {
  const prisma = {
    account: {
      findMany: vi.fn(),
    },
    userAccountAccess: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves GET /api/dashboard/accounts/search shape", async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: "acc-1", name: "Acme", domain: "acme.com", industry: "SaaS" },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/accounts/search?q=ac");

      expect(res.status).toBe(200);
      expect(res.body.accounts).toEqual([
        { id: "acc-1", name: "Acme", domain: "acme.com", industry: "SaaS" },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/crm-reports validation contract", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/crm-reports?provider=invalid");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid provider. Use SALESFORCE or HUBSPOT.");
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/crm-reports mapping", async () => {
    prisma.userAccountAccess.findMany.mockResolvedValue([
      {
        crmReportId: "rep-1",
        crmReportName: "Enterprise Accounts",
        crmProvider: "SALESFORCE",
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/crm-reports?provider=salesforce");

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([
        { id: "rep-1", name: "Enterprise Accounts", provider: "SALESFORCE" },
      ]);
    } finally {
      close();
    }
  });
});
