/**
 * StoryEngine — Main Application Entry Point
 *
 * Wires together all services, middleware, and routes into a single Express
 * application with BullMQ worker for async transcript processing.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { Queue, Worker } from "bullmq";

import { createMergeWebhookHandler } from "./webhooks/merge-webhook.js";
import { createRAGRoutes } from "./api/rag-routes.js";
import { createStoryRoutes } from "./api/story-routes.js";
import { createLandingPageRoutes } from "./api/landing-page-routes.js";
import { createPublicPageRoutes } from "./api/public-page-renderer.js";
import { createDashboardRoutes } from "./api/dashboard-routes.js";
import {
  createTrialGate,
  createCheckoutHandler,
  createStripeWebhookHandler,
} from "./middleware/billing.js";
import { AITagger } from "./services/ai-tagger.js";
import { RAGEngine } from "./services/rag-engine.js";
import { StoryBuilder } from "./services/story-builder.js";
import {
  TranscriptProcessor,
  type ProcessCallJob,
} from "./services/transcript-processor.js";
import {
  WeeklyStoryRegeneration,
  type WeeklyRegenJobData,
} from "./services/weekly-story-regeneration.js";
import { EmailService } from "./services/email.js";

// ─── Init ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia",
});

const openaiApiKey = process.env.OPENAI_API_KEY ?? "";
const pineconeApiKey = process.env.PINECONE_API_KEY ?? "";
const pineconeIndex = process.env.PINECONE_INDEX ?? "storyengine-transcripts";

// Services
const aiTagger = new AITagger(prisma, openaiApiKey);
const ragEngine = new RAGEngine(prisma, {
  openaiApiKey,
  pineconeApiKey,
  pineconeIndex,
});
const storyBuilder = new StoryBuilder(prisma, openaiApiKey);
const transcriptProcessor = new TranscriptProcessor(
  prisma,
  aiTagger,
  ragEngine
);
const emailService = new EmailService(
  process.env.RESEND_API_KEY ?? "",
  process.env.STORY_REGEN_FROM_EMAIL ?? "StoryEngine <noreply@storyengine.io>",
  process.env.APP_URL ?? "http://localhost:3000"
);
const weeklyStoryRegen = new WeeklyStoryRegeneration(
  prisma,
  storyBuilder,
  emailService
);

// ─── BullMQ Queue ────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const processingQueue = new Queue("call-processing", {
  connection: { url: REDIS_URL },
});

// Worker processes calls asynchronously
const worker = new Worker<ProcessCallJob>(
  "call-processing",
  async (job) => {
    await transcriptProcessor.processCall(job.data);
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 3,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed for call ${job.data.callId}`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

// ─── Story Regeneration Queue (Weekly) ──────────────────────────────────────

const storyRegenQueue = new Queue<WeeklyRegenJobData>("story-regeneration", {
  connection: { url: REDIS_URL },
});

// Register the repeatable schedule — every Sunday at 02:00 UTC
storyRegenQueue.upsertJobScheduler(
  "weekly-story-regen",
  { pattern: "0 2 * * 0" },
  {
    name: "weekly-story-regen",
    data: {},
    opts: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
    },
  }
);

const storyRegenWorker = new Worker<WeeklyRegenJobData>(
  "story-regeneration",
  async (job) => {
    console.log(`[story-regen] Starting weekly regeneration job ${job.id}`);
    const result = await weeklyStoryRegen.run(job.data);
    console.log(
      `[story-regen] Job ${job.id} done: ${result.accountsProcessed} accounts, ${result.orgsNotified} orgs, ${result.errors.length} errors`
    );
    return result;
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1, // only one regen run at a time
  }
);

storyRegenWorker.on("completed", (job) => {
  console.log(`[story-regen] Job ${job.id} completed`);
});

storyRegenWorker.on("failed", (job, err) => {
  console.error(`[story-regen] Job ${job?.id} failed:`, err.message);
});

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// Global middleware
app.use(helmet());
app.use(cors());

// Stripe webhooks need raw body
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  createStripeWebhookHandler(prisma, stripe)
);

// All other routes use JSON parsing
app.use(express.json({ limit: "10mb" }));

// ─── Public Routes ───────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "storyengine", version: "0.1.0" });
});

// Merge.dev webhook (authenticated by signature, not user auth)
app.post(
  "/api/webhooks/merge",
  createMergeWebhookHandler({ prisma, processingQueue })
);

// Public landing pages — no auth, served at /s/:slug
app.use("/s", createPublicPageRoutes(prisma));

// ─── Authenticated Routes ────────────────────────────────────────────────────
// In production, WorkOS auth middleware would go here to set req.organizationId,
// req.userId, and req.userRole.
// Omitted for architectural clarity — see docs/ARCHITECTURE.md for flow.

const trialGate = createTrialGate(prisma, stripe);

// Billing
app.post("/api/billing/checkout", createCheckoutHandler(prisma, stripe));

// RAG Chatbot Connector (behind trial gate)
app.use("/api/rag", trialGate, createRAGRoutes(ragEngine));

// Story Builder (behind trial gate)
app.use("/api/stories", trialGate, createStoryRoutes(storyBuilder, prisma));

// Landing Pages — CRUD, edit, publish, share (behind trial gate)
app.use("/api/pages", trialGate, createLandingPageRoutes(prisma));

// Dashboard — stats, page list, admin settings, permissions, account access
app.use("/api/dashboard", trialGate, createDashboardRoutes(prisma));

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`StoryEngine listening on port ${PORT}`);
  console.log(`  Health:     http://localhost:${PORT}/api/health`);
  console.log(`  RAG API:    http://localhost:${PORT}/api/rag/query`);
  console.log(`  Stories:    http://localhost:${PORT}/api/stories/build`);
  console.log(`  Pages:      http://localhost:${PORT}/api/pages`);
  console.log(`  Dashboard:  http://localhost:${PORT}/api/dashboard`);
  console.log(`  Public:     http://localhost:${PORT}/s/:slug`);
  console.log(`  Webhook:    http://localhost:${PORT}/api/webhooks/merge`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await worker.close();
  await storyRegenWorker.close();
  await processingQueue.close();
  await storyRegenQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
