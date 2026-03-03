import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerAdminSettingsRoutes } from "./admin-settings-routes.js";

function buildApp(prisma: any, permManager: any) {
  const app = express();
  const router = express.Router();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authReq = req as unknown as {
      organizationId?: string;
      userId?: string;
      userRole?: string;
    };
    authReq.organizationId = "org-test";
    authReq.userId = "user-test";
    authReq.userRole = "ADMIN";
    next();
  });

  registerAdminSettingsRoutes({
    router,
    prisma,
    permManager,
    auditLogs: { record: vi.fn().mockResolvedValue(undefined) } as any,
    deleteGovernedTarget: vi.fn().mockResolvedValue(true),
  });

  app.use("/api/dashboard", router);
  return app;
}

describe("admin settings routes", () => {
  let prisma: any;
  let permManager: any;

  beforeEach(() => {
    prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    permManager = {
      updateOrgSettings: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("preserves GET /api/dashboard/settings defaults", async () => {
    const app = buildApp(prisma, permManager);
    const res = await request(app).get("/api/dashboard/settings");

    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      landing_pages_enabled: true,
      default_page_visibility: "PRIVATE",
      require_approval_to_publish: false,
      allowed_publishers: ["OWNER", "ADMIN"],
      max_pages_per_user: null,
      company_name_replacements: {},
    });
  });

  it("preserves GET /api/dashboard/settings with persisted settings", async () => {
    prisma.orgSettings.findUnique.mockResolvedValue({
      landingPagesEnabled: false,
      defaultPageVisibility: "SHARED_WITH_LINK",
      requireApprovalToPublish: true,
      allowedPublishers: ["OWNER"],
      maxPagesPerUser: 10,
      companyNameReplacements: { Acme: "Customer" },
    });

    const app = buildApp(prisma, permManager);
    const res = await request(app).get("/api/dashboard/settings");

    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      landingPagesEnabled: false,
      defaultPageVisibility: "SHARED_WITH_LINK",
      requireApprovalToPublish: true,
      allowedPublishers: ["OWNER"],
      maxPagesPerUser: 10,
      companyNameReplacements: { Acme: "Customer" },
    });
  });

  it("accepts PATCH /api/dashboard/settings payload and delegates to PermissionManager", async () => {
    const app = buildApp(prisma, permManager);
    const res = await request(app).patch("/api/dashboard/settings").send({
      landing_pages_enabled: true,
      require_approval_to_publish: true,
      max_pages_per_user: 25,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expect(permManager.updateOrgSettings).toHaveBeenCalledWith("org-test", {
      landingPagesEnabled: true,
      defaultPageVisibility: undefined,
      requireApprovalToPublish: true,
      allowedPublishers: undefined,
      maxPagesPerUser: 25,
      companyNameReplacements: undefined,
    });
  });

  it("rejects invalid PATCH /api/dashboard/settings payload", async () => {
    const app = buildApp(prisma, permManager);
    const res = await request(app).patch("/api/dashboard/settings").send({
      default_page_visibility: "PUBLIC",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
