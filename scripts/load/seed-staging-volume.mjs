import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const dryRun = process.argv.includes("--dry-run");
const prisma = dryRun ? null : new PrismaClient();

const EMPLOYEES = Number(process.env.SEED_EMPLOYEES || 300);
const ACCOUNTS = Number(process.env.SEED_ACCOUNTS || 450);
const CALLS_PER_ACCOUNT = Number(process.env.SEED_CALLS_PER_ACCOUNT || 3);
const STORIES_PER_ACCOUNT = Number(process.env.SEED_STORIES_PER_ACCOUNT || 1);
const PAGES_PER_STORY = Number(process.env.SEED_PAGES_PER_STORY || 1);
const ORG_ID = process.env.SEED_ORG_ID || "";
const ORG_NAME = process.env.SEED_ORG_NAME || "Staging Volume Org";

const now = Date.now();
const CHUNK = 500;

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function createManySafe(modelName, rows) {
  if (dryRun) return rows.length;
  if (rows.length === 0) return 0;
  let count = 0;
  for (const batch of chunked(rows, CHUNK)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await prisma[modelName].createMany({
      data: batch,
      skipDuplicates: true,
    });
    count += result.count;
  }
  return count;
}

async function main() {
  const organization = dryRun
    ? { id: ORG_ID || "org_dry_run", name: ORG_NAME }
    : ORG_ID
      ? await prisma.organization.upsert({
          where: { id: ORG_ID },
          create: { id: ORG_ID, name: ORG_NAME, plan: "PROFESSIONAL" },
          update: { name: ORG_NAME },
        })
      : await prisma.organization.create({
          data: { name: ORG_NAME, plan: "PROFESSIONAL" },
        });

  const users = [];
  const ownerId = uid("usr_owner");
  users.push({
    id: ownerId,
    organizationId: organization.id,
    email: `owner+${Date.now()}@example.com`,
    name: "Owner User",
    role: "OWNER",
  });

  for (let i = 0; i < EMPLOYEES - 1; i += 1) {
    const role = i % 25 === 0 ? "ADMIN" : i % 9 === 0 ? "VIEWER" : "MEMBER";
    users.push({
      id: uid("usr"),
      organizationId: organization.id,
      email: `user.${now}.${i}@example.com`,
      name: `User ${i}`,
      role,
    });
  }

  const accounts = [];
  for (let i = 0; i < ACCOUNTS; i += 1) {
    const id = uid("acct");
    accounts.push({
      id,
      organizationId: organization.id,
      name: `Account ${i}`,
      normalizedName: `account ${i}`,
      domain: `acct-${now}-${i}.example.com`,
      industry: i % 3 === 0 ? "SaaS" : i % 3 === 1 ? "Fintech" : "Healthcare",
      employeeCount: 100 + (i % 1900),
      annualRevenue: 1_000_000 + i * 10_000,
    });
  }

  const calls = [];
  const transcripts = [];
  const callTags = [];
  for (const [idx, account] of accounts.entries()) {
    for (let c = 0; c < CALLS_PER_ACCOUNT; c += 1) {
      const callId = uid("call");
      const occurredAt = new Date(now - (idx * CALLS_PER_ACCOUNT + c) * 3_600_000);
      calls.push({
        id: callId,
        organizationId: organization.id,
        accountId: account.id,
        title: `Call ${idx}-${c}`,
        provider: "GONG",
        externalId: `ext-${now}-${idx}-${c}`,
        duration: 1800 + (c % 4) * 600,
        occurredAt,
        matchMethod: "MANUAL",
        matchConfidence: 0.92,
      });

      const transcriptId = uid("tr");
      transcripts.push({
        id: transcriptId,
        callId,
        fullText: `Synthetic transcript for ${account.name} call ${c}.`,
        language: "en",
        wordCount: 120 + c * 10,
      });

      callTags.push({
        id: uid("tag"),
        callId,
        funnelStage: c % 2 === 0 ? "MOFU" : "POST_SALE",
        topic: c % 2 === 0 ? "implementation_onboarding" : "roi_financial_outcomes",
        confidence: 0.84,
      });
    }
  }

  const stories = [];
  for (const [idx, account] of accounts.entries()) {
    for (let s = 0; s < STORIES_PER_ACCOUNT; s += 1) {
      stories.push({
        id: uid("story"),
        organizationId: organization.id,
        accountId: account.id,
        title: `Story ${idx}-${s}`,
        markdownBody: `# Story ${idx}-${s}\n\nSynthetic story body for ${account.name}.`,
        storyType: s % 2 === 0 ? "FULL_JOURNEY" : "ROI_ANALYSIS",
        funnelStages: s % 2 === 0 ? ["MOFU", "BOFU"] : ["BOFU", "POST_SALE"],
        filterTags: s % 2 === 0 ? ["implementation_onboarding"] : ["roi_financial_outcomes"],
        generatedById: users[(idx + s) % users.length].id,
        confidenceScore: 0.78,
      });
    }
  }

  const pages = [];
  for (const story of stories) {
    for (let p = 0; p < PAGES_PER_STORY; p += 1) {
      pages.push({
        id: uid("page"),
        organizationId: organization.id,
        storyId: story.id,
        createdById: story.generatedById,
        slug: `seed-${story.id.slice(-10)}-${p}`,
        title: `${story.title} Page ${p + 1}`,
        subtitle: "Synthetic seeded page",
        editableBody: story.markdownBody,
        scrubbedBody: story.markdownBody,
        totalCallHours: 4.5,
        visibility: "SHARED_WITH_LINK",
        status: p % 2 === 0 ? "PUBLISHED" : "DRAFT",
        includeCompanyName: false,
        noIndex: true,
        publishedAt: p % 2 === 0 ? new Date() : null,
      });
    }
  }

  const usageRecords = [
    {
      id: uid("usage"),
      organizationId: organization.id,
      metric: "CALLS_PROCESSED",
      quantity: calls.length,
      periodStart: new Date(now - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
    },
    {
      id: uid("usage"),
      organizationId: organization.id,
      metric: "STORIES_GENERATED",
      quantity: stories.length,
      periodStart: new Date(now - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
    },
    {
      id: uid("usage"),
      organizationId: organization.id,
      metric: "PAGES_PUBLISHED",
      quantity: pages.filter((p) => p.status === "PUBLISHED").length,
      periodStart: new Date(now - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
    },
  ];

  const insertedUsers = await createManySafe("user", users);
  const insertedAccounts = await createManySafe("account", accounts);
  const insertedCalls = await createManySafe("call", calls);
  const insertedTranscripts = await createManySafe("transcript", transcripts);
  const insertedCallTags = await createManySafe("callTag", callTags);
  const insertedStories = await createManySafe("story", stories);
  const insertedPages = await createManySafe("landingPage", pages);
  const insertedUsage = await createManySafe("usageRecord", usageRecords);

  console.log(dryRun ? "Staging volume seed dry-run complete:" : "Staging volume seed complete:");
  console.log(`- organization_id: ${organization.id}`);
  console.log(`- users: +${insertedUsers}`);
  console.log(`- accounts: +${insertedAccounts}`);
  console.log(`- calls: +${insertedCalls}`);
  console.log(`- transcripts: +${insertedTranscripts}`);
  console.log(`- call_tags: +${insertedCallTags}`);
  console.log(`- stories: +${insertedStories}`);
  console.log(`- landing_pages: +${insertedPages}`);
  console.log(`- usage_records: +${insertedUsage}`);
}

main()
  .catch((err) => {
    console.error("Failed to seed staging volume:", err);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
