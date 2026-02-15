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
import rateLimit from "express-rate-limit";

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
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

const deadLetterQueue = new Queue("call-processing-dlq", {
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

worker.on("failed", async (job, err) => {
  console.error(`Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await deadLetterQueue.add("failed-job", {
      originalJobId: job.id,
      data: job.data,
      failedReason: err.message,
      failedAt: new Date().toISOString(),
    });
    console.error(`Job ${job.id} moved to dead letter queue after ${job.attemptsMade} attempts`);
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

// ─── Rate Limiting ──────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const publicPageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Public Routes ───────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "storyengine", version: "0.1.0" });
});

// Merge.dev webhook (authenticated by signature, not user auth)
app.post(
  "/api/webhooks/merge",
  webhookLimiter,
  createMergeWebhookHandler({ prisma, processingQueue })
);

// Public landing pages — no auth, served at /s/:slug
app.use("/s", publicPageLimiter, createPublicPageRoutes(prisma));

// ─── Authenticated Routes ────────────────────────────────────────────────────
// In production, WorkOS auth middleware would go here to set req.organizationId,
// req.userId, and req.userRole.
// Omitted for architectural clarity — see docs/ARCHITECTURE.md for flow.

const trialGate = createTrialGate(prisma, stripe);

// Billing
app.post("/api/billing/checkout", apiLimiter, createCheckoutHandler(prisma, stripe));

// RAG Chatbot Connector (behind trial gate)
app.use("/api/rag", apiLimiter, trialGate, createRAGRoutes(ragEngine));

// Story Builder (behind trial gate)
app.use("/api/stories", apiLimiter, trialGate, createStoryRoutes(storyBuilder, prisma));

// Landing Pages — CRUD, edit, publish, share (behind trial gate)
app.use("/api/pages", apiLimiter, trialGate, createLandingPageRoutes(prisma));

// Dashboard — stats, page list, admin settings, permissions, account access
app.use("/api/dashboard", apiLimiter, trialGate, createDashboardRoutes(prisma));

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
  await deadLetterQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
