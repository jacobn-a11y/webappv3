import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";

function createApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "user-admin";
    (req as Record<string, unknown>).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("customer success dashboard routes", () => {
  const prisma = {
    user: { count: vi.fn() },
    aIUsageRecord: { findMany: vi.fn() },
    story: { count: vi.fn() },
    landingPage: { count: vi.fn() },
    integrationConfig: { count: vi.fn() },
    approvalRequest: { count: vi.fn() },
    setupWizard: { findUnique: vi.fn() },
    userRoleAssignment: { findMany: vi.fn() },
    teamWorkspace: { groupBy: vi.fn() },
    sharedAsset: { groupBy: vi.fn() },
    usageRecord: { groupBy: vi.fn() },
    subscription: { findFirst: vi.fn() },
    callTag: { groupBy: vi.fn() },
    userPermission: { findUnique: vi.fn() },
    supportImpersonationSession: { findFirst: vi.fn(), update: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.count.mockResolvedValue(20);
    prisma.aIUsageRecord.findMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
      { userId: "u3" },
    ]);
    prisma.story.count.mockResolvedValue(40);
    prisma.landingPage.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(18);
    prisma.integrationConfig.count.mockResolvedValue(1);
    prisma.approvalRequest.count.mockResolvedValue(6);
    prisma.setupWizard.findUnique.mockResolvedValue({
      recordingProvider: "GONG",
      crmProvider: "SALESFORCE",
      syncedAccountCount: 50,
      selectedPlan: "PROFESSIONAL",
      permissionsConfiguredAt: new Date(),
    });
    prisma.userRoleAssignment.findMany.mockResolvedValue([
      { userId: "u1", roleProfile: { key: "SALES" } },
      { userId: "u2", roleProfile: { key: "CS" } },
    ]);
    prisma.teamWorkspace.groupBy.mockResolvedValue([
      { team: "SALES", _count: 1 },
      { team: "CS", _count: 2 },
    ]);
    prisma.sharedAsset.groupBy.mockResolvedValue([
      { visibility: "TEAM", _count: 6 },
      { visibility: "ORG", _count: 2 },
    ]);
    prisma.usageRecord.groupBy.mockResolvedValue([
      { metric: "TRANSCRIPT_MINUTES", _sum: { quantity: 1234 } },
    ]);
    prisma.subscription.findFirst.mockResolvedValue({
      status: "ACTIVE",
      billingInterval: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      contractValue: 250000,
    });
    prisma.callTag.groupBy.mockResolvedValue([
      { topic: "roi_financial_outcomes", _count: 8 },
      { topic: "renewal_partnership_evolution", _count: 4 },
    ]);
  });

  it("returns customer success health summary", async () => {
    const app = createApp(prisma);

    const res = await request(app).get("/api/dashboard/customer-success/health");

    expect(res.status).toBe(200);
    expect(res.body.overall_score).toBeTypeOf("number");
    expect(res.body.adoption_rate_pct).toBe(15);
    expect(res.body.teams).toEqual(expect.any(Array));
    expect(res.body.risk_indicators).toEqual(expect.any(Array));
  });

  it("returns renewal value report", async () => {
    const app = createApp(prisma);

    const res = await request(app).get(
      "/api/dashboard/customer-success/renewal-value-report"
    );

    expect(res.status).toBe(200);
    expect(res.body.renewal_health).toMatch(/STRONG|WATCH|AT_RISK/);
    expect(res.body.outcomes.stories_generated_90d).toBe(40);
    expect(res.body.roi_narrative).toContain("90 days");
  });
});
