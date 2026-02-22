import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createDashboardRoutes } from "./dashboard-routes.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock dependencies that dashboard-routes imports
vi.mock("../services/landing-page-editor.js", () => ({
  LandingPageEditor: class MockLandingPageEditor {
    getDashboardStats = vi.fn().mockResolvedValue({});
    listForOrg = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("../services/account-access.js", () => ({
  AccountAccessService: class MockAccountAccessService {
    listUserAccess = vi.fn().mockResolvedValue([]);
    grantAccess = vi.fn().mockResolvedValue("grant-1");
    revokeAccess = vi.fn().mockResolvedValue(undefined);
    syncCrmReportGrant = vi.fn().mockResolvedValue({ accountCount: 0 });
  },
}));

vi.mock("../middleware/permissions.js", () => ({
  PermissionManager: class MockPermissionManager {
    updateOrgSettings = vi.fn().mockResolvedValue(undefined);
    getOrgPermissionMatrix = vi.fn().mockResolvedValue([]);
    grantPermission = vi.fn().mockResolvedValue(undefined);
    revokePermission = vi.fn().mockResolvedValue(undefined);
  },
  requirePermission: () => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
  requireLandingPagesEnabled: () => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
  requirePageOwnerOrPermission: () => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

function createMockPrisma() {
  return {
    orgSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    userPermission: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    landingPage: {
      findFirst: vi.fn(),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createApp(prisma: ReturnType<typeof createMockPrisma>) {
  const app = express();
  app.use(express.json());
  // Add auth context to every request
  app.use((req, _res, next) => {
    (req as any).organizationId = "org-test";
    (req as any).userId = "user-test";
    (req as any).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma as any));
  return app;
}

async function request(
  app: express.Express,
  method: "get" | "patch",
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = { __parseError: true, raw: data.substring(0, 200) };
          }
          resolve({ status: res.statusCode, body });
        });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Dashboard Routes - Settings", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    prisma = createMockPrisma();
    app = createApp(prisma);
  });

  describe("GET /api/dashboard/settings", () => {
    it("should return transcript merge settings from database when settings exist", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue({
        landingPagesEnabled: true,
        defaultPageVisibility: "PRIVATE",
        requireApprovalToPublish: false,
        allowedPublishers: ["OWNER", "ADMIN"],
        maxPagesPerUser: null,
        companyNameReplacements: {},
        transcriptMergeMaxWords: 120_000,
        transcriptTruncationMode: "NEWEST_FIRST",
      });

      const res = await request(app, "get", "/api/dashboard/settings");

      expect(res.status).toBe(200);
      expect(res.body.settings.transcript_merge_max_words).toBe(120_000);
      expect(res.body.settings.transcript_truncation_mode).toBe("NEWEST_FIRST");
    });

    it("should return defaults when no org settings exist", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);

      const res = await request(app, "get", "/api/dashboard/settings");

      expect(res.status).toBe(200);
      expect(res.body.settings.transcript_merge_max_words).toBe(600_000);
      expect(res.body.settings.transcript_truncation_mode).toBe("OLDEST_FIRST");
    });
  });

  describe("PATCH /api/dashboard/settings", () => {
    it("should accept transcript_merge_max_words update", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_merge_max_words: 76_800,
      });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
    });

    it("should accept transcript_truncation_mode update", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_truncation_mode: "NEWEST_FIRST",
      });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
    });

    it("should reject invalid truncation mode", async () => {
      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_truncation_mode: "INVALID_MODE",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should reject max_words below minimum (1000)", async () => {
      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_merge_max_words: 500,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should reject max_words above maximum (2,000,000)", async () => {
      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_merge_max_words: 3_000_000,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should accept both transcript settings together", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      const res = await request(app, "patch", "/api/dashboard/settings", {
        transcript_merge_max_words: 120_000,
        transcript_truncation_mode: "OLDEST_FIRST",
      });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
    });
  });
});
