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

describe("dashboard artifact governance contract", () => {
  const prisma = {
    artifactGovernancePolicy: {
      findUnique: vi.fn(),
    },
    teamApprovalAdminScope: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves GET /api/dashboard/artifact-governance defaults", async () => {
    prisma.artifactGovernancePolicy.findUnique.mockResolvedValue(null);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/artifact-governance");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        approval_chain_enabled: false,
        max_expiration_days: null,
        require_provenance: true,
        steps: [],
      });
    } finally {
      close();
    }
  });

  it("preserves PUT /api/dashboard/artifact-governance/steps duplicate-order validation", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.put("/api/dashboard/artifact-governance/steps").send({
        steps: [
          { step_order: 1, min_approvals: 1 },
          { step_order: 1, min_approvals: 1 },
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "validation_error",
        message: "Each approval step_order must be unique.",
      });
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/approval-admin-scopes grouping shape", async () => {
    prisma.teamApprovalAdminScope.findMany.mockResolvedValue([
      {
        userId: "u-1",
        teamKey: "SALES",
        user: { id: "u-1", name: "One", email: "one@example.com" },
      },
      {
        userId: "u-1",
        teamKey: "CS",
        user: { id: "u-1", name: "One", email: "one@example.com" },
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/approval-admin-scopes");

      expect(res.status).toBe(200);
      expect(res.body.scopes).toEqual([
        {
          user: { id: "u-1", name: "One", email: "one@example.com" },
          team_keys: ["SALES", "CS"],
        },
      ]);
    } finally {
      close();
    }
  });
});
