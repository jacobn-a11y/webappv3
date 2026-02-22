/**
 * Integration Test Helpers
 *
 * Provides a shared PrismaClient pointed at the test database, an Express app
 * factory that wires the landing-page routes with injectable auth, and seed
 * data builders.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { createLandingPageRoutes } from "../src/api/landing-page-routes.js";
import { createPublicPageRoutes } from "../src/api/public-page-renderer.js";

// ─── Test Prisma Client ──────────────────────────────────────────────────────

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://user:password@localhost:5432/storyengine_test";

export const prisma = new PrismaClient({
  datasourceUrl: TEST_DATABASE_URL,
});

// ─── Auth context injected per-request in tests ──────────────────────────────

export interface TestAuth {
  organizationId: string;
  userId: string;
  userRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

/**
 * Builds an Express app with landing-page routes.  The `auth` parameter is
 * injected into every request so that route-level middleware sees the values
 * it expects without requiring a real WorkOS auth flow.
 */
export function buildApp(auth: TestAuth) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Fake auth middleware — sets the fields routes rely on
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).organizationId = auth.organizationId;
    (req as any).userId = auth.userId;
    (req as any).userRole = auth.userRole;
    next();
  });

  // Public landing pages (no auth required, mounted before trial gate)
  app.use("/s", createPublicPageRoutes(prisma));

  // Protected landing page API (skip trial gate for tests)
  app.use("/api/pages", createLandingPageRoutes(prisma));

  return app;
}

// ─── Seed Data Builders ──────────────────────────────────────────────────────

export interface SeedResult {
  organization: { id: string };
  adminUser: { id: string; email: string };
  memberUser: { id: string; email: string };
  account: { id: string; name: string };
  story: { id: string };
}

/**
 * Seeds the minimum entities needed to exercise the landing-page lifecycle.
 *
 * Creates:  Organization → OrgSettings → Admin User + Member User →
 *           Account (with contacts + domain aliases) → Story (with quotes)
 *           + Calls (for totalCallHours calculation)
 */
export async function seedTestData(): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      plan: "PROFESSIONAL",
    },
  });

  await prisma.orgSettings.create({
    data: {
      organizationId: org.id,
      landingPagesEnabled: true,
      allowedPublishers: ["OWNER", "ADMIN"],
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: "admin@testorg.com",
      name: "Admin User",
      organizationId: org.id,
      role: "ADMIN",
    },
  });

  const memberUser = await prisma.user.create({
    data: {
      email: "member@testorg.com",
      name: "Member User",
      organizationId: org.id,
      role: "MEMBER",
    },
  });

  const account = await prisma.account.create({
    data: {
      organizationId: org.id,
      name: "Acme Corporation",
      normalizedName: "acme corporation",
      domain: "acme.com",
    },
  });

  // Give member user access to all accounts so they can create pages
  await prisma.userAccountAccess.create({
    data: {
      userId: memberUser.id,
      organizationId: org.id,
      scopeType: "ALL_ACCOUNTS",
    },
  });

  // Domain alias
  await prisma.accountDomain.create({
    data: { accountId: account.id, domain: "acmecorp.io" },
  });

  // Contacts with titles (these will be scrubbed)
  await prisma.contact.create({
    data: {
      accountId: account.id,
      email: "jane.doe@acme.com",
      emailDomain: "acme.com",
      name: "Jane Doe",
      title: "CEO",
    },
  });

  await prisma.contact.create({
    data: {
      accountId: account.id,
      email: "bob.smith@acme.com",
      emailDomain: "acme.com",
      name: "Bob Smith",
      title: "VP of Engineering",
    },
  });

  // Calls (for totalCallHours badge)
  await prisma.call.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      provider: "GONG",
      duration: 3600, // 1 hour
      occurredAt: new Date(),
    },
  });
  await prisma.call.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      provider: "GONG",
      duration: 5400, // 1.5 hours
      occurredAt: new Date(),
    },
  });

  const story = await prisma.story.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      title: "Acme Corporation Success Story",
      markdownBody: [
        "# How Acme Corporation Transformed Their Workflow",
        "",
        "Acme Corporation partnered with us to overhaul their legacy systems.",
        "",
        "> \"We reduced costs by 40% in the first quarter\" — Jane Doe, CEO",
        "",
        "Bob Smith, VP of Engineering, led the technical integration with acme.com systems.",
        "",
        "## Results",
        "",
        "- **40% cost reduction** within 90 days",
        "- Deployment time cut from 2 weeks to 2 days",
        "- Acme's engineering team saw 3x productivity gains",
      ].join("\n"),
      storyType: "FULL_JOURNEY",
      funnelStages: ["TOFU", "BOFU"],
    },
  });

  // Quotes for default callout boxes
  await prisma.highValueQuote.create({
    data: {
      storyId: story.id,
      speaker: "Jane Doe",
      quoteText: "We reduced costs by 40% in the first quarter",
      metricType: "cost_savings",
      metricValue: "40%",
    },
  });

  await prisma.highValueQuote.create({
    data: {
      storyId: story.id,
      speaker: "Bob Smith",
      quoteText: "Deployment time cut from 2 weeks to 2 days",
      metricType: "time_saved",
      metricValue: "85%",
    },
  });

  return {
    organization: { id: org.id },
    adminUser: { id: adminUser.id, email: adminUser.email },
    memberUser: { id: memberUser.id, email: memberUser.email },
    account: { id: account.id, name: account.name },
    story: { id: story.id },
  };
}

/**
 * Wipes all rows from every table used in tests.  Deletion order respects
 * foreign-key constraints.
 */
export async function cleanDatabase(): Promise<void> {
  await prisma.landingPageEdit.deleteMany();
  await prisma.landingPage.deleteMany();
  await prisma.highValueQuote.deleteMany();
  await prisma.story.deleteMany();
  await prisma.callParticipant.deleteMany();
  await prisma.call.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.accountDomain.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.userAccountAccess.deleteMany();
  await prisma.account.deleteMany();
  await prisma.orgSettings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}
