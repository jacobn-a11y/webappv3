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
import { Queue, Worker, UnrecoverableError } from "bullmq";

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
  TranscriptFetcher,
  TranscriptFetchError,
  transcriptFetchBackoffStrategy,
  type TranscriptFetchJob,
} from "./services/transcript-fetcher.js";

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

const transcriptFetchQueue = new Queue("transcript-fetching", {
  connection: { url: REDIS_URL },
});

// ─── Transcript Fetcher Service ─────────────────────────────────────────────

const transcriptFetcher = new TranscriptFetcher({
  prisma,
  processingQueue,
  mergeApiKey: process.env.MERGE_API_KEY ?? "",
});

// ─── Workers ────────────────────────────────────────────────────────────────

// Worker: process calls (chunking → PII masking → tagging → embedding)
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

// Worker: poll Merge.dev for transcripts not included in webhooks
const transcriptFetchWorker = new Worker<TranscriptFetchJob>(
  "transcript-fetching",
  async (job) => {
    try {
      await transcriptFetcher.fetchTranscript(job.data);
    } catch (err) {
      if (err instanceof TranscriptFetchError && !err.retryable) {
        // Non-retryable errors (e.g. 404) should not be retried
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 2,
    settings: {
      backoffStrategy: transcriptFetchBackoffStrategy as (
        attemptsMade: number,
        type: string | undefined,
        err: Error | undefined,
        job: unknown
      ) => number,
    },
  }
);

transcriptFetchWorker.on("completed", (job) => {
  console.log(
    `Transcript fetch completed for call ${job.data.callId} ` +
      `(${job.data.provider})`
  );
});

transcriptFetchWorker.on("failed", (job, err) => {
  if (job && job.attemptsMade < (job.opts?.attempts ?? 0)) {
    console.log(
      `Transcript fetch attempt ${job.attemptsMade} failed for ` +
        `call ${job.data.callId} (${job.data.provider}), will retry: ${err.message}`
    );
  } else {
    console.error(
      `Transcript fetch exhausted all retries for call ${job?.data.callId} ` +
        `(${job?.data.provider}): ${err.message}`
    );
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
  createMergeWebhookHandler({ prisma, processingQueue, transcriptFetchQueue })
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
  await transcriptFetchWorker.close();
  await processingQueue.close();
  await transcriptFetchQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
