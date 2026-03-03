import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";
import { FeatureFlagService } from "../../src/services/feature-flags.js";

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

describe("dashboard billing contract", () => {
  const prisma = {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    usageRecord: {
      findMany: vi.fn(),
    },
    call: {
      findMany: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
    vi.spyOn(FeatureFlagService.prototype, "getResolvedEnabledKeys").mockResolvedValue([
      "ops_dashboard",
    ]);
  });

  it("preserves GET /api/dashboard/billing/readiness shape", async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      plan: "SCALE",
      pricingModel: "SEAT",
      billingChannel: "STRIPE",
      seatLimit: 10,
    });
    prisma.user.findMany.mockResolvedValue([{ role: "ADMIN" }, { role: "MEMBER" }]);
    prisma.subscription.findFirst.mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      seatCount: 10,
      includedUnits: 500,
      meteredUnitPrice: 2.5,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-01-31T00:00:00.000Z"),
    });
    prisma.usageRecord.findMany.mockResolvedValue([
      { metric: "TRANSCRIPT_MINUTES", quantity: 620, periodStart: new Date(), periodEnd: new Date() },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/billing/readiness");

      expect(res.status).toBe(200);
      expect(res.body.organization).toEqual({
        plan: "SCALE",
        pricing_model: "SEAT",
        billing_channel: "STRIPE",
      });
      expect(res.body.seats.used).toBe(2);
      expect(res.body.overage).toEqual({
        metric: "TRANSCRIPT_MINUTES",
        included_units: 500,
        used_units: 620,
        overage_units: 120,
        projected_cost: 300,
      });
      expect(res.body.entitlements.feature_flags).toContain("ops_dashboard");
    } finally {
      close();
    }
  });

  it("preserves PATCH /api/dashboard/billing/seats contract", async () => {
    prisma.organization.update.mockResolvedValue({ id: "org-1" });
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.patch("/api/dashboard/billing/seats").send({ seat_limit: 25 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: true });
      expect(prisma.organization.update).toHaveBeenCalled();
      expect(prisma.subscription.updateMany).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/billing/reconciliation shape", async () => {
    prisma.usageRecord.findMany.mockResolvedValue([
      {
        quantity: 200,
        periodStart: new Date(),
        periodEnd: new Date(),
        reportedToStripe: true,
      },
      {
        quantity: 100,
        periodStart: new Date(),
        periodEnd: new Date(),
        reportedToStripe: false,
      },
    ]);
    prisma.call.findMany.mockResolvedValue([
      { duration: 3600, occurredAt: new Date() },
      { duration: 1800, occurredAt: new Date() },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/billing/reconciliation");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        window_days: 30,
        metered_minutes: 300,
        computed_minutes: 90,
        delta_minutes: 210,
        status: "CRITICAL",
        stripe_report_coverage_percent: 50,
      });
      expect(typeof res.body.mismatch_percent).toBe("number");
    } finally {
      close();
    }
  });
});
