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

describe("dashboard admin settings contract", () => {
  const prisma = {
    orgSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
  });

  it("preserves GET /api/dashboard/settings contract", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/settings");

      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        landing_pages_enabled: true,
        default_page_visibility: "PRIVATE",
        require_approval_to_publish: false,
        allowed_publishers: ["OWNER", "ADMIN"],
        max_pages_per_user: null,
      });
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/story-context contract", async () => {
    prisma.orgSettings.findUnique.mockResolvedValue({
      storyContext: {
        companyOverview: "Overview",
        products: ["StoryEngine"],
        targetPersonas: ["RevOps"],
      },
      storyPromptDefaults: {
        storyLength: "SHORT",
        storyOutline: "CHRONOLOGICAL_JOURNEY",
        storyFormat: "CASE_STUDY",
        storyType: "FULL_ACCOUNT_JOURNEY",
      },
    });

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/story-context");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        company_overview: "Overview",
        products: ["StoryEngine"],
        target_personas: ["RevOps"],
        default_story_length: "SHORT",
        default_story_outline: "CHRONOLOGICAL_JOURNEY",
        default_story_format: "CASE_STUDY",
        default_story_type: "FULL_ACCOUNT_JOURNEY",
      });
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/data-governance defaults", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/data-governance");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        retention_days: 365,
        audit_log_retention_days: 365,
        legal_hold_enabled: false,
        pii_export_enabled: true,
        deletion_requires_approval: true,
        allow_named_story_exports: false,
        rto_target_minutes: 240,
        rpo_target_minutes: 60,
      });
    } finally {
      close();
    }
  });
});
