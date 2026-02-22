/**
 * StoryEngine — Main Application Entry Point
 *
 * Slim entrypoint that initializes observability, creates infrastructure
 * clients, wires together services/queues/app, and starts the server.
 */

import { initOtel, shutdownOtel } from "./lib/otel.js";

// Initialize OpenTelemetry before all other imports so instrumentation
// can patch modules (http, express, prisma) before they are loaded.
initOtel();

import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { WorkOS } from "@workos-inc/node";

import { createServices } from "./services.js";
import { createQueues, createWorkers } from "./queues.js";
import { createApp } from "./app.js";
import logger from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";

// ─── Sentry ──────────────────────────────────────────────────────────────────

initSentry();

// ─── Infrastructure ──────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2025-02-24.acacia",
});

const workos = new WorkOS(process.env.WORKOS_API_KEY ?? "");

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const mergeApiKey = process.env.MERGE_API_KEY ?? "";

// ─── Queues, Services & App ──────────────────────────────────────────────────

const queues = createQueues(REDIS_URL);

const services = createServices(prisma, queues.processingQueue, {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  pineconeApiKey: process.env.PINECONE_API_KEY ?? "",
  pineconeIndex: process.env.PINECONE_INDEX ?? "storyengine-transcripts",
  mergeApiKey,
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  regenFromEmail:
    process.env.STORY_REGEN_FROM_EMAIL ??
    "StoryEngine <noreply@storyengine.io>",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
});

const workers = createWorkers(REDIS_URL, services, prisma, stripe);

const app = createApp({
  prisma,
  stripe,
  workos,
  queues,
  services,
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  logger.info(`StoryEngine listening on port ${PORT}`);

  // Start Merge.dev polling if API key is configured
  if (mergeApiKey) {
    services.mergeClient.startPolling();
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  workers.usageCron.stop();
  services.mergeClient.stopPolling();
  await workers.callWorker.close();
  await workers.transcriptFetchWorker.close();
  await workers.syncWorker.close();
  await workers.storyRegenWorker.close();
  await queues.processingQueue.close();
  await queues.transcriptFetchQueue.close();
  await queues.syncQueue.close();
  await queues.storyRegenQueue.close();
  await shutdownOtel();
  await prisma.$disconnect();
  process.exit(0);
});
