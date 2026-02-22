import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { createStatusRoutes } from "../../src/api/status-routes.js";

function createDashboardApp(prisma: any, auth: { userRole?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "admin-1";
    (req as Record<string, unknown>).userRole = auth.userRole ?? "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

function createPublicStatusApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/status", createStatusRoutes(prisma));
  return app;
}

describe("incident/status routes", () => {
  const prisma = {
    orgSettings: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    userPermission: { findUnique: vi.fn() },
    incident: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    incidentUpdate: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("creates an incident and logs audit", async () => {
    prisma.incident.create.mockResolvedValue({
      id: "inc-1",
      status: "OPEN",
      title: "API latency spike",
      severity: "HIGH",
      createdAt: new Date(),
    });

    const app = createDashboardApp(prisma);
    const res = await request(app).post("/api/dashboard/ops/incidents").send({
      title: "API latency spike",
      summary: "P95 elevated across customer dashboard endpoints.",
      severity: "HIGH",
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("inc-1");
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("adds update and transitions status", async () => {
    prisma.incident.findFirst.mockResolvedValue({ id: "inc-1", status: "OPEN" });
    prisma.incidentUpdate.create.mockResolvedValue({
      id: "upd-1",
      createdAt: new Date(),
    });
    prisma.incident.update.mockResolvedValue({ id: "inc-1", status: "MONITORING" });
    prisma.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => {
      const out = [];
      for (const op of ops) {
        // eslint-disable-next-line no-await-in-loop
        out.push(await op);
      }
      return out;
    });

    const app = createDashboardApp(prisma);
    const res = await request(app)
      .post("/api/dashboard/ops/incidents/inc-1/updates")
      .send({
        message: "Mitigation applied, monitoring impact.",
        status: "MONITORING",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("MONITORING");
  });

  it("returns public status incidents for org", async () => {
    const startedAt = new Date();
    const updatedAt = new Date();
    prisma.incident.findMany.mockResolvedValue([
      {
        id: "inc-1",
        title: "Queue delay",
        summary: "Background processing delayed.",
        severity: "MEDIUM",
        status: "OPEN",
        startedAt,
        updatedAt,
        updates: [
          {
            id: "upd-1",
            message: "Investigating.",
            status: "OPEN",
            createdAt: startedAt,
          },
        ],
      },
    ]);

    const app = createPublicStatusApp(prisma);
    const res = await request(app).get("/api/status/incidents?organization_id=org-1");

    expect(res.status).toBe(200);
    expect(res.body.incidents).toHaveLength(1);
    expect(res.body.incidents[0].title).toBe("Queue delay");
  });
});
