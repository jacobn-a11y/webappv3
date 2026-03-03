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

describe("dashboard security contract", () => {
  const prisma = {
    orgSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    orgIpAllowlistEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
    prisma.orgIpAllowlistEntry.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("preserves GET /api/dashboard/security-policy defaults", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/security-policy");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enforce_mfa_for_admin_actions: false,
        sso_enforced: false,
        allowed_sso_domains: [],
        session_controls_enabled: false,
        max_session_age_hours: 720,
        reauth_interval_minutes: 60,
        ip_allowlist_enabled: false,
        ip_allowlist: [],
      });
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/security/ip-allowlist contract", async () => {
    prisma.orgIpAllowlistEntry.findMany.mockResolvedValue([
      {
        id: "entry-1",
        cidr: "10.0.0.0/24",
        label: "office",
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/security/ip-allowlist");

      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([
        {
          id: "entry-1",
          cidr: "10.0.0.0/24",
          label: "office",
          enabled: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/security/outbound-webhooks defaults", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/security/outbound-webhooks");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        subscriptions: [],
        supported_events: [
          "landing_page_published",
          "story_generated",
          "story_generation_failed",
          "scheduled_report_generated",
          "webhook.test",
          "ALL_EVENTS",
        ],
      });
    } finally {
      close();
    }
  });

  it("supports POST /api/dashboard/security/outbound-webhooks", async () => {
    prisma.orgSettings.upsert.mockResolvedValue({ organizationId: "org-1" });

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request
        .post("/api/dashboard/security/outbound-webhooks")
        .send({
          url: "https://example.com/hook",
          event_types: ["story_generated"],
          enabled: true,
          secret: "this-is-a-long-enough-secret",
        });

      expect(res.status).toBe(201);
      expect(res.body.subscription).toEqual(
        expect.objectContaining({
          url: "https://example.com/hook",
          event_types: ["story_generated"],
          enabled: true,
        })
      );
      expect(typeof res.body.subscription.id).toBe("string");
      expect(typeof res.body.subscription.secret).toBe("string");
      expect(prisma.orgSettings.upsert).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("returns 404 when deleting unknown outbound webhook subscription", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.delete(
        "/api/dashboard/security/outbound-webhooks/missing-subscription"
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("outbound_webhook_not_found");
    } finally {
      close();
    }
  });
});
