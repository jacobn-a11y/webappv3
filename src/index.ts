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
  globalRateLimiter,
  expensiveRateLimiter,
  webhookRateLimiter,
  authRateLimiter,
} from "./middleware/rate-limiter.js";
import { NotificationService } from "./services/notification-service.js";
import { createNotificationRoutes } from "./api/notification-routes.js";

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

// Lazy-initialized notification service for the worker (set after app init)
let workerNotificationService: NotificationService | null = null;

worker.on("completed", async (job) => {
  console.log(`Job ${job.id} completed for call ${job.data.callId}`);
  if (workerNotificationService && job.data.organizationId) {
    await workerNotificationService.notifyCallProcessed(
      job.data.organizationId,
      job.data.callId
    ).catch((err) => console.error("Notification error:", err));
  }
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
  if (workerNotificationService && job?.data?.organizationId) {
    workerNotificationService.notifyCallProcessingFailed(
      job.data.organizationId,
      job.data.callId,
      err.message
    ).catch((notifErr) => console.error("Notification error:", notifErr));
  }
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
  webhookRateLimiter,
  createMergeWebhookHandler({ prisma, processingQueue })
);

// Public landing pages — no auth, served at /s/:slug
app.use("/s", createPublicPageRoutes(prisma));

// ─── Authenticated Routes ────────────────────────────────────────────────────
// In production, WorkOS auth middleware would go here to set req.organizationId,
// req.userId, and req.userRole.
// Omitted for architectural clarity — see docs/ARCHITECTURE.md for flow.

const trialGate = createTrialGate(prisma, stripe);
const notificationService = new NotificationService(prisma);
workerNotificationService = notificationService;

// Billing
app.post("/api/billing/checkout", authRateLimiter, createCheckoutHandler(prisma, stripe));

// Global rate limiter on all authenticated routes
app.use("/api/rag", trialGate, expensiveRateLimiter, createRAGRoutes(ragEngine));

// Story Builder (behind trial gate + expensive rate limit)
app.use("/api/stories", trialGate, expensiveRateLimiter, createStoryRoutes(storyBuilder, prisma, notificationService));

// Landing Pages — CRUD, edit, publish, share (behind trial gate)
app.use("/api/pages", trialGate, globalRateLimiter, createLandingPageRoutes(prisma));

// Dashboard — stats, page list, admin settings, permissions, account access
app.use("/api/dashboard", trialGate, globalRateLimiter, createDashboardRoutes(prisma));

// Notifications
app.use("/api/notifications", trialGate, globalRateLimiter, createNotificationRoutes(notificationService));

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
  await processingQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
