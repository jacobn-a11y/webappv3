/**
 * StoryEngine — Main Application Entry Point
 *
 * Wires together all services, middleware, and routes into a single Express
 * application with BullMQ worker for async transcript processing.
 */

import { initOtel, shutdownOtel } from "./lib/otel.js";

// Initialize OpenTelemetry before all other imports so instrumentation
// can patch modules (http, express, prisma) before they are loaded.
initOtel();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { WorkOS } from "@workos-inc/node";
import { Queue, Worker } from "bullmq";

import { createMergeWebhookHandler } from "./webhooks/merge-webhook.js";
import { createAuthRoutes } from "./api/auth-routes.js";
import { createRAGRoutes } from "./api/rag-routes.js";
import { createStoryRoutes } from "./api/story-routes.js";
import { createLandingPageRoutes } from "./api/landing-page-routes.js";
import { createPublicPageRoutes } from "./api/public-page-renderer.js";
import { createDashboardRoutes } from "./api/dashboard-routes.js";
import { createAdminMetricsRoutes } from "./api/admin-metrics-routes.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import {
  createTrialGate,
  createCheckoutHandler,
  createStripeWebhookHandler,
} from "./middleware/billing.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import { AITagger } from "./services/ai-tagger.js";
import { RAGEngine } from "./services/rag-engine.js";
import { StoryBuilder } from "./services/story-builder.js";
import {
  TranscriptProcessor,
  type ProcessCallJob,
} from "./services/transcript-processor.js";
import logger, { jobStore } from "./lib/logger.js";
import { metrics } from "./lib/metrics.js";
import { initSentry, Sentry } from "./lib/sentry.js";

// ─── Sentry ─────────────────────────────────────────────────────────────────

initSentry();

// ─── Init ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia",
});

const workos = new WorkOS(process.env.WORKOS_API_KEY ?? "");

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
    const ctx = {
      jobId: job.id ?? "unknown",
      callId: job.data.callId,
      organizationId: job.data.organizationId,
      accountId: job.data.accountId,
    };

    // Run the processor within a job context so all logs include job metadata
    await jobStore.run(ctx, async () => {
      logger.info("Job started", {
        hasTranscript: job.data.hasTranscript,
        attempt: job.attemptsMade + 1,
      });
      await transcriptProcessor.processCall(job.data);
    });
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 3,
  }
);

worker.on("completed", (job) => {
  logger.info("Job completed", {
    jobId: job.id,
    callId: job.data.callId,
  });
});

worker.on("failed", (job, err) => {
  logger.error("Job failed", {
    jobId: job?.id,
    callId: job?.data.callId,
    error: err.message,
    stack: err.stack,
  });
  Sentry.captureException(err, {
    tags: { jobId: job?.id, callId: job?.data.callId },
  });
});

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// Sentry request handler (must be first middleware)
Sentry.setupExpressErrorHandler(app);

// Global middleware
app.use(helmet());
app.use(cors());

// Request ID tracing (before any route handlers)
app.use(requestIdMiddleware);

// Stripe webhooks need raw body
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  createStripeWebhookHandler(prisma, stripe)
);

// All other routes use JSON parsing
app.use(express.json({ limit: "10mb" }));

// Request logging (after body parsing so we can log status codes)
app.use(requestLoggingMiddleware);

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

// ─── Admin Metrics ───────────────────────────────────────────────────────────
// Mounted before trial gate — admin metrics should be accessible with
// admin-level auth only (in production, add appropriate auth middleware).
app.use("/api/admin/metrics", createAdminMetricsRoutes(prisma));

// ─── Auth Routes (public — no JWT required) ─────────────────────────────────

app.use("/api/auth", createAuthRoutes(prisma, workos));

// ─── Authenticated Routes ────────────────────────────────────────────────────
// WorkOS middleware verifies JWT and sets req.organizationId, req.userId, req.userRole.

app.use(createAuthMiddleware(prisma, workos));

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
  logger.info(`StoryEngine listening on port ${PORT}`, {
    endpoints: {
      health: `http://localhost:${PORT}/api/health`,
      rag: `http://localhost:${PORT}/api/rag/query`,
      stories: `http://localhost:${PORT}/api/stories/build`,
      pages: `http://localhost:${PORT}/api/pages`,
      dashboard: `http://localhost:${PORT}/api/dashboard`,
      auth: `http://localhost:${PORT}/api/auth/login`,
      public: `http://localhost:${PORT}/s/:slug`,
      webhook: `http://localhost:${PORT}/api/webhooks/merge`,
      metrics: `http://localhost:${PORT}/api/admin/metrics`,
    },
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  await worker.close();
  await processingQueue.close();
  await shutdownOtel();
  await prisma.$disconnect();
  process.exit(0);
});
