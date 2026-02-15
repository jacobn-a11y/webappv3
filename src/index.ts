/**
 * StoryEngine — Main Application Entry Point
 *
 * Wires together all services, middleware, and routes into a single Express
 * application with BullMQ workers for async transcript processing and
 * integration sync.
 *
 * Integration Architecture:
 *   - Direct integrations (Grain, Gong, SFDC) use polling-based sync
 *     via the SyncEngine, plus optional real-time webhooks.
 *   - Merge.dev (unified API) is gated behind an IntegrationConfig flag,
 *     allowing operators to enable it later for multi-provider SaaS use.
 *   - All integrations feed into the same processing pipeline:
 *     Call → Transcript → Chunk → Tag → Embed
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { Queue, Worker } from "bullmq";

import { createMergeWebhookHandler } from "./webhooks/merge-webhook.js";
import { createGongWebhookHandler } from "./webhooks/gong-webhook.js";
import { createGrainWebhookHandler } from "./webhooks/grain-webhook.js";
import { createRAGRoutes } from "./api/rag-routes.js";
import { createStoryRoutes } from "./api/story-routes.js";
import { createLandingPageRoutes } from "./api/landing-page-routes.js";
import { createPublicPageRoutes } from "./api/public-page-renderer.js";
import { createDashboardRoutes } from "./api/dashboard-routes.js";
import { createIntegrationRoutes } from "./api/integration-routes.js";
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
import { createProviderRegistry } from "./integrations/provider-registry.js";
import { SyncEngine } from "./integrations/sync-engine.js";

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

// ─── BullMQ Queues ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const processingQueue = new Queue("call-processing", {
  connection: { url: REDIS_URL },
});

const syncQueue = new Queue("integration-sync", {
  connection: { url: REDIS_URL },
});

// Worker: processes calls asynchronously (chunk → tag → embed)
const callWorker = new Worker<ProcessCallJob>(
  "call-processing",
  async (job) => {
    await transcriptProcessor.processCall(job.data);
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 3,
  }
);

callWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed for call ${job.data.callId}`);
});

callWorker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

// ─── Integration Provider Registry & Sync Engine ────────────────────────────

const providerRegistry = createProviderRegistry();
const syncEngine = new SyncEngine(prisma, processingQueue, providerRegistry);

// Worker: runs integration sync on a schedule
const syncWorker = new Worker(
  "integration-sync",
  async () => {
    await syncEngine.syncAll();
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1, // only one sync cycle at a time
  }
);

syncWorker.on("completed", (job) => {
  console.log(`Integration sync job ${job.id} completed`);
});

syncWorker.on("failed", (job, err) => {
  console.error(`Integration sync job ${job?.id} failed:`, err.message);
});

// Schedule repeatable sync every 15 minutes (configurable via env)
const SYNC_INTERVAL_MS = parseInt(
  process.env.SYNC_INTERVAL_MINUTES ?? "15",
  10
) * 60 * 1000;

syncQueue.upsertJobScheduler(
  "periodic-sync",
  { every: SYNC_INTERVAL_MS },
  { name: "sync-all-integrations" }
).then(() => {
  console.log(`Integration sync scheduled every ${SYNC_INTERVAL_MS / 60000} minutes`);
}).catch((err) => {
  console.error("Failed to schedule integration sync:", err);
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
  res.json({ status: "ok", service: "storyengine", version: "0.2.0" });
});

// Merge.dev webhook (gated by IntegrationConfig — only processes if enabled)
app.post(
  "/api/webhooks/merge",
  createMergeWebhookHandler({ prisma, processingQueue })
);

// Gong webhook — real-time call recording notifications
app.post(
  "/api/webhooks/gong",
  createGongWebhookHandler({ prisma, processingQueue })
);

// Grain webhook — real-time recording notifications
app.post(
  "/api/webhooks/grain",
  createGrainWebhookHandler({ prisma, processingQueue })
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

// Integration Management — configure Grain, Gong, SFDC, Merge.dev (behind trial gate)
app.use(
  "/api/integrations",
  trialGate,
  createIntegrationRoutes(prisma, providerRegistry, syncEngine)
);

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`StoryEngine listening on port ${PORT}`);
  console.log(`  Health:        http://localhost:${PORT}/api/health`);
  console.log(`  RAG API:       http://localhost:${PORT}/api/rag/query`);
  console.log(`  Stories:       http://localhost:${PORT}/api/stories/build`);
  console.log(`  Pages:         http://localhost:${PORT}/api/pages`);
  console.log(`  Dashboard:     http://localhost:${PORT}/api/dashboard`);
  console.log(`  Integrations:  http://localhost:${PORT}/api/integrations`);
  console.log(`  Public:        http://localhost:${PORT}/s/:slug`);
  console.log(`  Webhooks:`);
  console.log(`    Merge.dev:   http://localhost:${PORT}/api/webhooks/merge`);
  console.log(`    Gong:        http://localhost:${PORT}/api/webhooks/gong`);
  console.log(`    Grain:       http://localhost:${PORT}/api/webhooks/grain`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await callWorker.close();
  await syncWorker.close();
  await processingQueue.close();
  await syncQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
