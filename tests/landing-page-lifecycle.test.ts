/**
 * Landing Page Lifecycle — Integration Tests
 *
 * Exercises the full lifecycle against a real PostgreSQL test database:
 *   1. Create a page from a story
 *   2. Edit the body
 *   3. Publish with scrubbing (company name removed, contacts anonymized)
 *   4. Verify the public route serves scrubbed HTML with noindex + AI badge
 *   5. Password protection
 *   6. Expiration (410 Gone)
 *   7. Named page flow (company name preserved when includeCompanyName=true)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import {
  prisma,
  buildApp,
  seedTestData,
  cleanDatabase,
  type SeedResult,
  type TestAuth,
} from "./helpers.js";

// ─── Database connectivity check ─────────────────────────────────────────────

let dbAvailable = false;
try {
  await prisma.$connect();
  dbAvailable = true;
} catch {
  // Database is not reachable — tests will be skipped
}

// ─── Shared State ────────────────────────────────────────────────────────────

let seed: SeedResult;

function adminAuth(): TestAuth {
  return {
    organizationId: seed.organization.id,
    userId: seed.adminUser.id,
    userRole: "ADMIN",
  };
}

function memberAuth(): TestAuth {
  return {
    organizationId: seed.organization.id,
    userId: seed.memberUser.id,
    userRole: "MEMBER",
  };
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!dbAvailable) return;
  await cleanDatabase();
  seed = await seedTestData();
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanDatabase();
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CREATE
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("POST /api/pages — create from story", () => {
  let pageId: string;
  let slug: string;

  it("creates a draft landing page", async () => {
    const app = buildApp(adminAuth());

    const res = await request(app)
      .post("/api/pages")
      .send({
        story_id: seed.story.id,
        title: "Acme Corporation Customer Story",
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBeDefined();
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.editable_body).toContain("Acme Corporation");
    expect(res.body.total_call_hours).toBeGreaterThan(0);

    pageId = res.body.id;
    slug = res.body.slug;
  });

  it("pre-populates editable body from the story markdown", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.editableBody).toContain("Jane Doe, CEO");
    expect(page.editableBody).toContain("Acme Corporation");
  });

  it("calculates totalCallHours from account calls", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    // 3600 + 5400 = 9000 seconds = 2.5 hours
    expect(page.totalCallHours).toBe(2.5);
  });

  it("generates default callout boxes from story quotes", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    const callouts = page.calloutBoxes as any[];
    expect(callouts.length).toBeGreaterThan(0);
    expect(callouts[0]).toHaveProperty("title");
    expect(callouts[0]).toHaveProperty("body");
  });

  it("generates a unique slug based on title", async () => {
    expect(slug).toMatch(/^acme-corporation-customer-story-[a-f0-9]+$/);
  });

  it("rejects creation with missing title", async () => {
    const app = buildApp(adminAuth());
    await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EDIT
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("PATCH /api/pages/:pageId — edit body", () => {
  let pageId: string;

  beforeEach(async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Edit Test Page" })
      .expect(201);
    pageId = res.body.id;
  });

  it("updates the editable body", async () => {
    const app = buildApp(adminAuth());
    const newBody =
      "# Updated Story\n\nAcme Corporation saw amazing results with Jane Doe, CEO leading the charge.";

    await request(app)
      .patch(`/api/pages/${pageId}`)
      .send({
        editable_body: newBody,
        edit_summary: "Rewrote intro paragraph",
      })
      .expect(200);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.editableBody).toBe(newBody);
  });

  it("records the edit in LandingPageEdit for audit trail", async () => {
    const app = buildApp(adminAuth());
    const original = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    const newBody = "# Completely new body content";
    await request(app)
      .patch(`/api/pages/${pageId}`)
      .send({ editable_body: newBody, edit_summary: "Complete rewrite" })
      .expect(200);

    const edits = await prisma.landingPageEdit.findMany({
      where: { landingPageId: pageId },
      orderBy: { createdAt: "desc" },
    });

    expect(edits).toHaveLength(1);
    expect(edits[0].previousBody).toBe(original.editableBody);
    expect(edits[0].newBody).toBe(newBody);
    expect(edits[0].editSummary).toBe("Complete rewrite");
    expect(edits[0].editedById).toBe(seed.adminUser.id);
  });

  it("updates title and subtitle without recording an edit (body unchanged)", async () => {
    const app = buildApp(adminAuth());

    await request(app)
      .patch(`/api/pages/${pageId}`)
      .send({ title: "New Title", subtitle: "A subtitle" })
      .expect(200);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.title).toBe("New Title");
    expect(page.subtitle).toBe("A subtitle");

    const edits = await prisma.landingPageEdit.findMany({
      where: { landingPageId: pageId },
    });
    expect(edits).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PUBLISH WITH SCRUBBING
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("POST /api/pages/:pageId/publish — scrubbing", () => {
  let pageId: string;
  let slug: string;

  beforeAll(async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Acme Corporation Results" })
      .expect(201);
    pageId = res.body.id;
    slug = res.body.slug;
  });

  it("publishes the page and returns the public URL", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .post(`/api/pages/${pageId}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(200);

    expect(res.body.published).toBe(true);
    expect(res.body.slug).toBe(slug);
    expect(res.body.url).toContain(`/s/${slug}`);
  });

  it("sets status to PUBLISHED with publishedAt timestamp", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.status).toBe("PUBLISHED");
    expect(page.publishedAt).toBeInstanceOf(Date);
    expect(page.noIndex).toBe(true);
  });

  it("scrubs the company name from scrubbedBody", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    // Original body contains "Acme Corporation" — scrubbed body should not
    expect(page.editableBody).toContain("Acme Corporation");
    expect(page.scrubbedBody).not.toContain("Acme Corporation");
    expect(page.scrubbedBody).not.toContain("Acme");
  });

  it("anonymizes contact names and titles", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    // "Jane Doe, CEO" should be replaced with an anonymized label
    expect(page.scrubbedBody).not.toContain("Jane Doe");
    expect(page.scrubbedBody).not.toContain("Bob Smith");

    // Should contain anonymized descriptors
    expect(page.scrubbedBody).toContain("a senior executive at the client");
  });

  it("scrubs email domains", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.scrubbedBody).not.toContain("acme.com");
  });

  it("replaces company name with 'the client'", async () => {
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.scrubbedBody).toContain("the client");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PUBLIC ROUTE — HTML, NOINDEX, AI BADGE
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("GET /s/:slug — public page rendering", () => {
  let slug: string;

  beforeAll(async () => {
    const app = buildApp(adminAuth());

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Public Route Test Page" })
      .expect(201);

    const pageId = createRes.body.id;

    await request(app)
      .post(`/api/pages/${pageId}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(200);

    slug = createRes.body.slug;
  });

  it("serves HTML with scrubbed content", async () => {
    // Public route needs no auth
    const app = buildApp(adminAuth());

    const res = await request(app).get(`/s/${slug}`).expect(200);

    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).not.toContain("Acme Corporation");
    expect(res.text).not.toContain("Jane Doe");
    expect(res.text).not.toContain("Bob Smith");
  });

  it("includes noindex meta tags", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app).get(`/s/${slug}`).expect(200);

    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(res.text).toContain('<meta name="googlebot" content="noindex, nofollow">');
  });

  it("includes noindex/nofollow response header", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app).get(`/s/${slug}`).expect(200);

    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["cache-control"]).toBe("private, no-cache");
  });

  it("includes the floating AI badge with call hours", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app).get(`/s/${slug}`).expect(200);

    expect(res.text).toContain("ai-badge");
    expect(res.text).toContain("Compiled by AI from");
    expect(res.text).toContain("of real call recordings with a specific client");
    // Total hours = 2.5
    expect(res.text).toContain("2.5 hours");
  });

  it("increments view count on each visit", async () => {
    const app = buildApp(adminAuth());

    const pageBefore = await prisma.landingPage.findFirst({
      where: { slug },
    });
    const countBefore = pageBefore!.viewCount;

    await request(app).get(`/s/${slug}`).expect(200);

    const pageAfter = await prisma.landingPage.findFirst({
      where: { slug },
    });
    expect(pageAfter!.viewCount).toBe(countBefore + 1);
  });

  it("returns 404 for non-existent slug", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app).get("/s/does-not-exist-abc123").expect(404);
    expect(res.text).toContain("Page not found");
  });

  it("returns 404 for PRIVATE visibility pages", async () => {
    const app = buildApp(adminAuth());

    // Create and publish as PRIVATE
    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Private Page" })
      .expect(201);

    await request(app)
      .post(`/api/pages/${createRes.body.id}/publish`)
      .send({ visibility: "PRIVATE" })
      .expect(200);

    await request(app).get(`/s/${createRes.body.slug}`).expect(404);
  });

  it("returns 404 for unpublished (DRAFT) pages", async () => {
    const app = buildApp(adminAuth());

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Draft Only Page" })
      .expect(201);

    // Never published — still DRAFT
    await request(app).get(`/s/${createRes.body.slug}`).expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PASSWORD PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("GET /s/:slug — password protection", () => {
  let slug: string;
  const PASSWORD = "secret1234";

  beforeAll(async () => {
    const app = buildApp(adminAuth());

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Password Protected Page" })
      .expect(201);

    await request(app)
      .post(`/api/pages/${createRes.body.id}/publish`)
      .send({
        visibility: "SHARED_WITH_LINK",
        password: PASSWORD,
      })
      .expect(200);

    slug = createRes.body.slug;
  });

  it("shows a password prompt when no password is provided", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app).get(`/s/${slug}`).expect(200);

    expect(res.text).toContain("This page is protected");
    expect(res.text).toContain('type="password"');
    expect(res.text).toContain("Enter the password");
    // Should NOT contain the actual page content
    expect(res.text).not.toContain("ai-badge");
  });

  it("shows a password prompt when wrong password is provided", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .get(`/s/${slug}?p=wrongpassword`)
      .expect(200);

    expect(res.text).toContain("This page is protected");
    expect(res.text).not.toContain("ai-badge");
  });

  it("serves the full page when correct password is provided", async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .get(`/s/${slug}?p=${PASSWORD}`)
      .expect(200);

    expect(res.text).toContain("ai-badge");
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("Compiled by AI from");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. EXPIRATION
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("GET /s/:slug — expiration", () => {
  it("returns 410 Gone for an expired page", async () => {
    const app = buildApp(adminAuth());

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Expiring Page" })
      .expect(201);

    // Publish with an already-past expiration
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await request(app)
      .post(`/api/pages/${createRes.body.id}/publish`)
      .send({
        visibility: "SHARED_WITH_LINK",
        expires_at: pastDate,
      })
      .expect(200);

    const res = await request(app)
      .get(`/s/${createRes.body.slug}`)
      .expect(410);

    expect(res.text).toContain("expired");
  });

  it("serves a page whose expiration is in the future", async () => {
    const app = buildApp(adminAuth());

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Future Expiry Page" })
      .expect(201);

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post(`/api/pages/${createRes.body.id}/publish`)
      .send({
        visibility: "SHARED_WITH_LINK",
        expires_at: futureDate,
      })
      .expect(200);

    const res = await request(app)
      .get(`/s/${createRes.body.slug}`)
      .expect(200);

    expect(res.text).toContain("ai-badge");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. NAMED PAGE FLOW (includeCompanyName = true)
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("Named page flow — includeCompanyName", () => {
  let namedPageId: string;
  let namedSlug: string;

  it("admin can create a named page (includeCompanyName=true)", async () => {
    const app = buildApp(adminAuth());

    const res = await request(app)
      .post("/api/pages")
      .send({
        story_id: seed.story.id,
        title: "Acme Corporation Named Story",
        include_company_name: true,
      })
      .expect(201);

    namedPageId = res.body.id;
    namedSlug = res.body.slug;

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: namedPageId },
    });
    expect(page.includeCompanyName).toBe(true);
  });

  it("non-admin without permission gets includeCompanyName silently ignored", async () => {
    const app = buildApp(memberAuth());

    // Give member CREATE permission so they can create pages
    await prisma.userPermission.create({
      data: {
        userId: seed.memberUser.id,
        permission: "CREATE_LANDING_PAGE",
        grantedById: seed.adminUser.id,
      },
    });

    const res = await request(app)
      .post("/api/pages")
      .send({
        story_id: seed.story.id,
        title: "Member Trying Named Page",
        include_company_name: true,
      })
      .expect(201);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    // Flag silently ignored because member lacks PUBLISH_NAMED_LANDING_PAGE
    expect(page.includeCompanyName).toBe(false);
  });

  it("non-admin WITH PUBLISH_NAMED_LANDING_PAGE permission can create named page", async () => {
    const app = buildApp(memberAuth());

    // Grant the named page permission
    await prisma.userPermission.upsert({
      where: {
        userId_permission: {
          userId: seed.memberUser.id,
          permission: "PUBLISH_NAMED_LANDING_PAGE",
        },
      },
      create: {
        userId: seed.memberUser.id,
        permission: "PUBLISH_NAMED_LANDING_PAGE",
        grantedById: seed.adminUser.id,
      },
      update: {},
    });

    const res = await request(app)
      .post("/api/pages")
      .send({
        story_id: seed.story.id,
        title: "Member Named Page With Permission",
        include_company_name: true,
      })
      .expect(201);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(page.includeCompanyName).toBe(true);
  });

  it("publishing a named page preserves company name (skips scrubbing)", async () => {
    const app = buildApp(adminAuth());

    await request(app)
      .post(`/api/pages/${namedPageId}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(200);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: namedPageId },
    });

    // scrubbedBody should still contain the company name (scrubbing was skipped)
    expect(page.scrubbedBody).toContain("Acme Corporation");
    expect(page.status).toBe("PUBLISHED");
  });

  it("public route serves the named page with company name visible", async () => {
    const app = buildApp(adminAuth());

    const res = await request(app).get(`/s/${namedSlug}`).expect(200);

    expect(res.text).toContain("Acme Corporation");
    expect(res.text).toContain("ai-badge");
    // Still has noindex
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. UNPUBLISH & ARCHIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("Unpublish and archive", () => {
  let pageId: string;
  let slug: string;

  beforeAll(async () => {
    const app = buildApp(adminAuth());
    const res = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Lifecycle Test Page" })
      .expect(201);

    pageId = res.body.id;
    slug = res.body.slug;

    await request(app)
      .post(`/api/pages/${pageId}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(200);
  });

  it("unpublish reverts status to DRAFT", async () => {
    const app = buildApp(adminAuth());

    await request(app)
      .post(`/api/pages/${pageId}/unpublish`)
      .expect(200);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.status).toBe("DRAFT");
    expect(page.publishedAt).toBeNull();
  });

  it("unpublished page returns 404 on public route", async () => {
    const app = buildApp(adminAuth());
    await request(app).get(`/s/${slug}`).expect(404);
  });

  it("archive sets status to ARCHIVED", async () => {
    const app = buildApp(adminAuth());

    await request(app)
      .post(`/api/pages/${pageId}/archive`)
      .expect(200);

    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(page.status).toBe("ARCHIVED");
  });

  it("archived page returns 404 on public route", async () => {
    const app = buildApp(adminAuth());
    await request(app).get(`/s/${slug}`).expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("Permission enforcement", () => {
  it("member without CREATE permission cannot create pages", async () => {
    // Clear any existing permissions for the member
    await prisma.userPermission.deleteMany({
      where: { userId: seed.memberUser.id },
    });

    const app = buildApp(memberAuth());
    await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Unauthorized Page" })
      .expect(403);
  });

  it("member without PUBLISH permission cannot publish", async () => {
    // Give CREATE permission back so they can create
    await prisma.userPermission.create({
      data: {
        userId: seed.memberUser.id,
        permission: "CREATE_LANDING_PAGE",
        grantedById: seed.adminUser.id,
      },
    });

    const app = buildApp(memberAuth());
    const res = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Member Page" })
      .expect(201);

    await request(app)
      .post(`/api/pages/${res.body.id}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(403);
  });

  it("returns 403 when landing pages feature is disabled", async () => {
    await prisma.orgSettings.update({
      where: { organizationId: seed.organization.id },
      data: { landingPagesEnabled: false },
    });

    const app = buildApp(adminAuth());
    await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "Feature Disabled Page" })
      .expect(403);

    // Re-enable for subsequent tests
    await prisma.orgSettings.update({
      where: { organizationId: seed.organization.id },
      data: { landingPagesEnabled: true },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. CUSTOM CSS
// ═══════════════════════════════════════════════════════════════════════════════

describe.runIf(dbAvailable)("Custom CSS", () => {
  it("includes custom CSS in the rendered public page", async () => {
    const app = buildApp(adminAuth());
    const customCss = ".content h1 { color: red; }";

    const createRes = await request(app)
      .post("/api/pages")
      .send({ story_id: seed.story.id, title: "CSS Test Page" })
      .expect(201);

    await request(app)
      .patch(`/api/pages/${createRes.body.id}`)
      .send({ custom_css: customCss })
      .expect(200);

    await request(app)
      .post(`/api/pages/${createRes.body.id}/publish`)
      .send({ visibility: "SHARED_WITH_LINK" })
      .expect(200);

    const res = await request(app)
      .get(`/s/${createRes.body.slug}`)
      .expect(200);

    expect(res.text).toContain(customCss);
  });
});
