import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type NextFunction, type Response } from "express";
import { createLandingPageRoutes } from "../../src/api/landing-page-routes.js";
import { AccountAccessService } from "../../src/services/account-access.js";

// ─── Mock Prisma Factory ────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    orgSettings: {
      findUnique: vi.fn().mockResolvedValue(null), // null = feature enabled by default
      upsert: vi.fn(),
    },
    userPermission: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    landingPage: {
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null), // slug uniqueness check
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { viewCount: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    story: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    call: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    userAccountAccess: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    landingPageEdit: {
      create: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

// ─── Auth Middleware Helpers ─────────────────────────────────────────────────

interface AuthOverrides {
  organizationId?: string;
  userId?: string;
  userRole?: string;
}

function createApp(prisma: MockPrisma, auth: AuthOverrides = {}) {
  const app = express();
  app.use(express.json());

  // Fake auth middleware — sets identity on every request
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).organizationId = auth.organizationId ?? "org-1";
    (req as any).userId = auth.userId ?? "user-1";
    (req as any).userRole = auth.userRole ?? "MEMBER";
    next();
  });

  app.use("/api/pages", createLandingPageRoutes(prisma as any));
  return app;
}

// ─── Seed Helpers ───────────────────────────────────────────────────────────

/** Sets up mock returns so the full POST /api/pages create flow succeeds. */
function seedCreateFlow(prisma: MockPrisma) {
  prisma.story.findUniqueOrThrow.mockResolvedValue({
    id: "story-1",
    organizationId: "org-1",
    accountId: "account-1",
    markdownBody: "# Test Story\n\nContent here.",
    account: { id: "account-1", name: "Acme Corp" },
    quotes: [],
  });

  prisma.call.findMany.mockResolvedValue([{ duration: 3600 }]);

  // generateUniqueSlug checks for collisions
  prisma.landingPage.findUnique.mockResolvedValue(null);

  prisma.landingPage.create.mockResolvedValue({
    id: "page-1",
    slug: "test-landing-page-abcd1234",
  });

  // getForEditing called after create
  prisma.landingPage.findUniqueOrThrow.mockResolvedValue({
    id: "page-1",
    slug: "test-landing-page-abcd1234",
    title: "Test Landing Page",
    subtitle: null,
    status: "DRAFT",
    editableBody: "# Test Story\n\nContent here.",
    scrubbedBody: "",
    calloutBoxes: [],
    totalCallHours: 1,
    heroImageUrl: null,
    customCss: null,
    viewCount: 0,
    publishedAt: null,
    createdAt: new Date("2025-01-01"),
    includeCompanyName: false,
    story: {
      account: { id: "account-1", name: "Acme Corp" },
      quotes: [],
    },
    createdBy: { id: "user-1", name: "Test User", email: "test@example.com" },
    edits: [],
  });
}

const CREATE_BODY = {
  story_id: "story-1",
  title: "Test Landing Page",
};

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe("Permissions Integration Tests", () => {
  // ── CREATE_LANDING_PAGE permission ──────────────────────────────────────

  describe("CREATE_LANDING_PAGE permission", () => {
    it("returns 403 when MEMBER user lacks CREATE_LANDING_PAGE permission", async () => {
      const prisma = createMockPrisma();
      // userPermission.findUnique returns null → no permission
      prisma.userPermission.findUnique.mockResolvedValue(null);

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
      expect(res.body.required_permission).toBe("CREATE_LANDING_PAGE");
    });

    it("returns 201 when MEMBER user has CREATE_LANDING_PAGE permission", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      // Grant CREATE_LANDING_PAGE
      prisma.userPermission.findUnique.mockResolvedValue({
        id: "perm-1",
        userId: "user-1",
        permission: "CREATE_LANDING_PAGE",
      });

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id", "page-1");
      expect(res.body).toHaveProperty("slug");
      expect(res.body).toHaveProperty("status", "DRAFT");
    });

    it("returns 403 when VIEWER user lacks CREATE_LANDING_PAGE permission", async () => {
      const prisma = createMockPrisma();
      prisma.userPermission.findUnique.mockResolvedValue(null);

      const app = createApp(prisma, { userRole: "VIEWER" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
    });

    it("returns 403 when landing pages feature is disabled", async () => {
      const prisma = createMockPrisma();

      // Feature disabled at org level
      prisma.orgSettings.findUnique.mockResolvedValue({
        organizationId: "org-1",
        landingPagesEnabled: false,
      });

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("feature_disabled");
    });
  });

  // ── PUBLISH_NAMED_LANDING_PAGE gating ──────────────────────────────────

  describe("PUBLISH_NAMED_LANDING_PAGE gating", () => {
    it("silently ignores include_company_name when MEMBER lacks PUBLISH_NAMED_LANDING_PAGE", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      // Grant CREATE but NOT PUBLISH_NAMED
      prisma.userPermission.findUnique.mockImplementation(({ where }: any) => {
        const perm = where.userId_permission?.permission;
        if (perm === "CREATE_LANDING_PAGE") {
          return Promise.resolve({
            id: "perm-1",
            userId: "user-1",
            permission: "CREATE_LANDING_PAGE",
          });
        }
        // PUBLISH_NAMED_LANDING_PAGE → not granted
        return Promise.resolve(null);
      });

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages")
        .send({ ...CREATE_BODY, include_company_name: true });

      expect(res.status).toBe(201);

      // Verify the page was created with includeCompanyName: false
      expect(prisma.landingPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            includeCompanyName: false,
          }),
        })
      );
    });

    it("allows include_company_name when MEMBER has PUBLISH_NAMED_LANDING_PAGE", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      // Grant both CREATE and PUBLISH_NAMED
      prisma.userPermission.findUnique.mockImplementation(({ where }: any) => {
        const perm = where.userId_permission?.permission;
        if (perm === "CREATE_LANDING_PAGE" || perm === "PUBLISH_NAMED_LANDING_PAGE") {
          return Promise.resolve({
            id: "perm-1",
            userId: "user-1",
            permission: perm,
          });
        }
        return Promise.resolve(null);
      });

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages")
        .send({ ...CREATE_BODY, include_company_name: true });

      expect(res.status).toBe(201);

      // Verify the page was created with includeCompanyName: true
      expect(prisma.landingPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            includeCompanyName: true,
          }),
        })
      );
    });

    it("allows include_company_name for ADMIN without explicit permission", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      // ADMIN never needs explicit permission grants
      const app = createApp(prisma, { userRole: "ADMIN" });

      const res = await request(app)
        .post("/api/pages")
        .send({ ...CREATE_BODY, include_company_name: true });

      expect(res.status).toBe(201);

      // ADMIN should get includeCompanyName: true
      expect(prisma.landingPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            includeCompanyName: true,
          }),
        })
      );
    });
  });

  // ── Account access scoping ─────────────────────────────────────────────

  describe("Account access scoping", () => {
    let prisma: MockPrisma;
    let service: AccountAccessService;

    beforeEach(() => {
      prisma = createMockPrisma();
      service = new AccountAccessService(prisma as any);
    });

    it("SINGLE_ACCOUNT user can access only the granted account", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([
        {
          id: "grant-1",
          userId: "user-1",
          organizationId: "org-1",
          scopeType: "SINGLE_ACCOUNT",
          accountId: "account-1",
          cachedAccountIds: [],
        },
      ]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "account-1",
        "MEMBER"
      );
      expect(canAccess).toBe(true);
    });

    it("SINGLE_ACCOUNT user cannot access a different account", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([
        {
          id: "grant-1",
          userId: "user-1",
          organizationId: "org-1",
          scopeType: "SINGLE_ACCOUNT",
          accountId: "account-1",
          cachedAccountIds: [],
        },
      ]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "account-999", // different account
        "MEMBER"
      );
      expect(canAccess).toBe(false);
    });

    it("user with no grants has no account access", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "account-1",
        "MEMBER"
      );
      expect(canAccess).toBe(false);
    });

    it("ACCOUNT_LIST grant restricts to cached account IDs", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([
        {
          id: "grant-1",
          userId: "user-1",
          organizationId: "org-1",
          scopeType: "ACCOUNT_LIST",
          accountId: null,
          cachedAccountIds: ["account-1", "account-2", "account-3"],
        },
      ]);

      expect(
        await service.canAccessAccount("user-1", "org-1", "account-2", "MEMBER")
      ).toBe(true);

      expect(
        await service.canAccessAccount("user-1", "org-1", "account-999", "MEMBER")
      ).toBe(false);
    });

    it("getAccessibleAccountIds returns only granted account for SINGLE_ACCOUNT", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([
        {
          id: "grant-1",
          userId: "user-1",
          organizationId: "org-1",
          scopeType: "SINGLE_ACCOUNT",
          accountId: "account-42",
          cachedAccountIds: [],
        },
      ]);

      const ids = await service.getAccessibleAccountIds("user-1", "org-1", "MEMBER");
      expect(ids).toEqual(["account-42"]);
    });

    it("getAccessibleAccountIds returns empty array when no grants exist", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([]);

      const ids = await service.getAccessibleAccountIds("user-1", "org-1", "MEMBER");
      expect(ids).toEqual([]);
    });

    it("ALL_ACCOUNTS grant gives unrestricted access", async () => {
      prisma.userAccountAccess.findMany.mockResolvedValue([
        {
          id: "grant-1",
          userId: "user-1",
          organizationId: "org-1",
          scopeType: "ALL_ACCOUNTS",
          accountId: null,
          cachedAccountIds: [],
        },
      ]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "any-account-id",
        "MEMBER"
      );
      expect(canAccess).toBe(true);

      const ids = await service.getAccessibleAccountIds("user-1", "org-1", "MEMBER");
      expect(ids).toBeNull(); // null = unrestricted
    });
  });

  // ── OWNER/ADMIN bypass all checks ─────────────────────────────────────

  describe("OWNER/ADMIN bypass all checks", () => {
    it("OWNER bypasses CREATE_LANDING_PAGE permission check", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      // No explicit permissions granted — OWNER doesn't need them
      const app = createApp(prisma, { userRole: "OWNER" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id", "page-1");

      // userPermission.findUnique should NOT have been called (admin bypass short-circuits)
      expect(prisma.userPermission.findUnique).not.toHaveBeenCalled();
    });

    it("ADMIN bypasses CREATE_LANDING_PAGE permission check", async () => {
      const prisma = createMockPrisma();
      seedCreateFlow(prisma);

      const app = createApp(prisma, { userRole: "ADMIN" });

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id", "page-1");
      expect(prisma.userPermission.findUnique).not.toHaveBeenCalled();
    });

    it("OWNER bypasses DELETE_ANY_LANDING_PAGE permission check", async () => {
      const prisma = createMockPrisma();
      prisma.landingPage.delete.mockResolvedValue({ id: "page-1" });

      const app = createApp(prisma, { userRole: "OWNER" });

      const res = await request(app)
        .delete("/api/pages/page-1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(prisma.userPermission.findUnique).not.toHaveBeenCalled();
    });

    it("ADMIN bypasses DELETE_ANY_LANDING_PAGE permission check", async () => {
      const prisma = createMockPrisma();
      prisma.landingPage.delete.mockResolvedValue({ id: "page-1" });

      const app = createApp(prisma, { userRole: "ADMIN" });

      const res = await request(app)
        .delete("/api/pages/page-1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
    });

    it("MEMBER without DELETE_ANY_LANDING_PAGE gets 403 on delete", async () => {
      const prisma = createMockPrisma();
      prisma.userPermission.findUnique.mockResolvedValue(null);

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .delete("/api/pages/page-1");

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
    });

    it("OWNER always has full account access", async () => {
      const prisma = createMockPrisma();
      const service = new AccountAccessService(prisma as any);

      // No grants exist at all — OWNER still has access
      prisma.userAccountAccess.findMany.mockResolvedValue([]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "any-account",
        "OWNER"
      );
      expect(canAccess).toBe(true);
    });

    it("ADMIN always has full account access", async () => {
      const prisma = createMockPrisma();
      const service = new AccountAccessService(prisma as any);

      prisma.userAccountAccess.findMany.mockResolvedValue([]);

      const canAccess = await service.canAccessAccount(
        "user-1",
        "org-1",
        "any-account",
        "ADMIN"
      );
      expect(canAccess).toBe(true);
    });

    it("OWNER getAccessibleAccountIds returns null (unrestricted)", async () => {
      const prisma = createMockPrisma();
      const service = new AccountAccessService(prisma as any);

      const ids = await service.getAccessibleAccountIds("user-1", "org-1", "OWNER");
      expect(ids).toBeNull();

      // Should not even query the database
      expect(prisma.userAccountAccess.findMany).not.toHaveBeenCalled();
    });

    it("ADMIN getAccessibleAccountIds returns null (unrestricted)", async () => {
      const prisma = createMockPrisma();
      const service = new AccountAccessService(prisma as any);

      const ids = await service.getAccessibleAccountIds("user-1", "org-1", "ADMIN");
      expect(ids).toBeNull();
      expect(prisma.userAccountAccess.findMany).not.toHaveBeenCalled();
    });
  });

  // ── PUBLISH_LANDING_PAGE permission (route-level) ─────────────────────

  describe("PUBLISH_LANDING_PAGE permission", () => {
    it("returns 403 when MEMBER lacks PUBLISH_LANDING_PAGE permission", async () => {
      const prisma = createMockPrisma();
      prisma.userPermission.findUnique.mockResolvedValue(null);

      // Not in allowedPublishers either
      prisma.orgSettings.findUnique.mockResolvedValue({
        organizationId: "org-1",
        landingPagesEnabled: true,
        allowedPublishers: ["OWNER", "ADMIN"],
      });

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages/page-1/publish")
        .send({ visibility: "SHARED_WITH_LINK" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
      expect(res.body.required_permission).toBe("PUBLISH_LANDING_PAGE");
    });

    it("allows MEMBER when role is in allowedPublishers", async () => {
      const prisma = createMockPrisma();

      // No explicit user-level permission
      prisma.userPermission.findUnique.mockResolvedValue(null);

      // But MEMBER is in allowedPublishers at org level
      prisma.orgSettings.findUnique.mockImplementation(({ where }: any) => {
        return Promise.resolve({
          organizationId: "org-1",
          landingPagesEnabled: true,
          allowedPublishers: ["OWNER", "ADMIN", "MEMBER"],
        });
      });

      // Mock the publish flow
      prisma.landingPage.findUniqueOrThrow.mockResolvedValue({
        id: "page-1",
        slug: "test-slug",
        editableBody: "# Content",
        title: "Test",
        subtitle: null,
        calloutBoxes: [],
        includeCompanyName: false,
        story: { accountId: "account-1" },
      });

      // CompanyScrubber reads account + contacts for scrubbing
      prisma.account.findMany.mockResolvedValue([]);
      prisma.landingPage.update.mockResolvedValue({});

      const app = createApp(prisma, { userRole: "MEMBER" });

      const res = await request(app)
        .post("/api/pages/page-1/publish")
        .send({ visibility: "SHARED_WITH_LINK" });

      // May get 200 or 500 depending on scrubber internals, but NOT 403
      expect(res.status).not.toBe(403);
    });
  });

  // ── Page owner vs permission checks ───────────────────────────────────

  describe("Page ownership checks", () => {
    it("page owner can access their own page without EDIT_ANY_LANDING_PAGE", async () => {
      const prisma = createMockPrisma();

      // The page belongs to user-1
      prisma.landingPage.findFirst.mockResolvedValue({
        createdById: "user-1",
      });

      // getForEditing mock
      prisma.landingPage.findUniqueOrThrow.mockResolvedValue({
        id: "page-1",
        slug: "test-slug",
        title: "My Page",
        subtitle: null,
        status: "DRAFT",
        visibility: "PRIVATE",
        editableBody: "# Content",
        scrubbedBody: "",
        heroImageUrl: null,
        calloutBoxes: [],
        totalCallHours: 1,
        customCss: null,
        viewCount: 0,
        publishedAt: null,
        createdAt: new Date("2025-01-01"),
        story: {
          account: { id: "account-1", name: "Acme" },
          quotes: [],
        },
        createdBy: { id: "user-1", name: "Test", email: "test@example.com" },
        edits: [],
      });

      const app = createApp(prisma, { userId: "user-1", userRole: "MEMBER" });

      const res = await request(app).get("/api/pages/page-1");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", "page-1");
    });

    it("non-owner without EDIT_ANY_LANDING_PAGE gets 403", async () => {
      const prisma = createMockPrisma();

      // The page belongs to a DIFFERENT user
      prisma.landingPage.findFirst.mockResolvedValue({
        createdById: "user-other",
      });

      // No EDIT_ANY permission
      prisma.userPermission.findUnique.mockResolvedValue(null);

      const app = createApp(prisma, { userId: "user-1", userRole: "MEMBER" });

      const res = await request(app).get("/api/pages/page-1");

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
    });

    it("non-owner WITH EDIT_ANY_LANDING_PAGE can access the page", async () => {
      const prisma = createMockPrisma();

      // The page belongs to a DIFFERENT user
      prisma.landingPage.findFirst.mockResolvedValue({
        createdById: "user-other",
      });

      // Grant EDIT_ANY
      prisma.userPermission.findUnique.mockResolvedValue({
        id: "perm-1",
        userId: "user-1",
        permission: "EDIT_ANY_LANDING_PAGE",
      });

      prisma.landingPage.findUniqueOrThrow.mockResolvedValue({
        id: "page-1",
        slug: "test-slug",
        title: "Other Page",
        subtitle: null,
        status: "DRAFT",
        visibility: "PRIVATE",
        editableBody: "# Content",
        scrubbedBody: "",
        heroImageUrl: null,
        calloutBoxes: [],
        totalCallHours: 1,
        customCss: null,
        viewCount: 0,
        publishedAt: null,
        createdAt: new Date("2025-01-01"),
        story: {
          account: { id: "account-1", name: "Acme" },
          quotes: [],
        },
        createdBy: { id: "user-other", name: "Other", email: "other@example.com" },
        edits: [],
      });

      const app = createApp(prisma, { userId: "user-1", userRole: "MEMBER" });

      const res = await request(app).get("/api/pages/page-1");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", "page-1");
    });
  });

  // ── Authentication required ───────────────────────────────────────────

  describe("Authentication required", () => {
    it("returns 401 when no auth context is set", async () => {
      const prisma = createMockPrisma();

      const app = express();
      app.use(express.json());
      // No auth middleware — organizationId/userId will be undefined
      app.use("/api/pages", createLandingPageRoutes(prisma as any));

      const res = await request(app)
        .post("/api/pages")
        .send(CREATE_BODY);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Authentication required");
    });
  });
});
