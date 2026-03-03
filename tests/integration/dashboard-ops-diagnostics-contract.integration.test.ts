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

describe("dashboard ops diagnostics contract", () => {
  const prisma = {
    integrationConfig: {
      findMany: vi.fn(),
    },
    integrationRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    account: {
      count: vi.fn(),
    },
    call: {
      count: vi.fn(),
    },
    story: {
      count: vi.fn(),
    },
    landingPage: {
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves GET /api/dashboard/integrations/health mapping", async () => {
    prisma.integrationConfig.findMany.mockResolvedValue([
      {
        id: "cfg-1",
        provider: "SALESFORCE",
        enabled: true,
        status: "OK",
        lastSyncAt: new Date("2026-01-10T00:00:00.000Z"),
        lastError: null,
        updatedAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    ]);
    prisma.integrationRun.findFirst
      .mockResolvedValueOnce({
        startedAt: new Date("2026-01-10T01:00:00.000Z"),
        finishedAt: new Date("2026-01-10T01:10:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    prisma.integrationRun.findMany.mockResolvedValue([
      { processedCount: 10, successCount: 9, failureCount: 1 },
      { processedCount: 5, successCount: 5, failureCount: 0 },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/integrations/health");

      expect(res.status).toBe(200);
      expect(res.body.integrations).toHaveLength(1);
      expect(res.body.integrations[0]).toMatchObject({
        id: "cfg-1",
        provider: "SALESFORCE",
        enabled: true,
        status: "OK",
        last_success_at: "2026-01-10T01:00:00.000Z",
        last_failure_at: null,
        last_failure_error: null,
        throughput_recent: 14,
        failures_recent: 1,
      });
      expect(typeof res.body.integrations[0].lag_minutes).toBe("number");
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/ops/dr-readiness shape", async () => {
    prisma.orgSettings.findUnique.mockResolvedValue({
      dataGovernancePolicy: {
        rto_target_minutes: 240,
        rpo_target_minutes: 60,
      },
    });
    prisma.auditLog.findFirst
      .mockResolvedValueOnce({ createdAt: new Date("2026-01-10T01:00:00.000Z"), metadata: {} })
      .mockResolvedValueOnce({ createdAt: new Date("2026-01-10T02:00:00.000Z"), metadata: {} });
    prisma.account.count.mockResolvedValue(20);
    prisma.call.count.mockResolvedValue(40);
    prisma.story.count.mockResolvedValue(60);
    prisma.landingPage.count.mockResolvedValue(8);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/ops/dr-readiness");

      expect(res.status).toBe(200);
      expect(res.body.targets).toEqual({ rto_minutes: 240, rpo_minutes: 60 });
      expect(res.body.critical_entity_counts).toEqual({
        accounts: 20,
        calls: 40,
        stories: 60,
        landing_pages: 8,
      });
      expect(res.body.status).toMatch(/READY|AT_RISK/);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/ops/replay-observability shape", async () => {
    prisma.auditLog.findMany = vi.fn().mockResolvedValue([
      {
        id: "audit-1",
        createdAt: new Date("2026-03-03T10:00:00.000Z"),
        action: "DEAD_LETTER_RUN_REPLAY_TRIGGERED",
        actorUserId: "admin-1",
        targetId: "run-source-1",
        metadata: {
          replay_run_id: "run-replay-1",
          replay_attempt: 2,
          replay_attempt_cap: 6,
          replay_window_hours: 72,
        },
      },
    ]);
    prisma.integrationRun.findMany = vi.fn().mockResolvedValue([
      {
        id: "run-source-1",
        provider: "GONG",
        runType: "SYNC",
        status: "FAILED",
        startedAt: new Date("2026-03-03T09:30:00.000Z"),
      },
      {
        id: "run-replay-1",
        provider: "GONG",
        runType: "REPLAY",
        status: "RUNNING",
        startedAt: new Date("2026-03-03T10:01:00.000Z"),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin User",
        role: "ADMIN",
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/ops/replay-observability");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        window_hours: 24,
        totals: {
          replay_triggers: 1,
          unique_operators: 1,
        },
      });
      expect(Array.isArray(res.body.outcomes)).toBe(true);
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(Array.isArray(res.body.operators)).toBe(true);
      expect(Array.isArray(res.body.recent_events)).toBe(true);
      expect(res.body.recent_events[0]).toMatchObject({
        audit_log_id: "audit-1",
        provider: "GONG",
        outcome: "RUNNING",
        actor_user_id: "admin-1",
        source_run_id: "run-source-1",
        replay_run_id: "run-replay-1",
        replay_attempt: 2,
        replay_attempt_cap: 6,
      });
      expect(res.body.operators[0]).toMatchObject({
        actor_user_id: "admin-1",
        actor_user_email: "admin@example.com",
        replay_triggers: 1,
      });
    } finally {
      close();
    }
  });
});
