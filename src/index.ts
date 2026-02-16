/**
 * StoryEngine — Main Application Entry Point
 *
 * Wires together all services, middleware, and routes into a single Express
 * application with BullMQ workers for async transcript processing, integration
 * syncing, transcript fetching, and weekly story regeneration.
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
import { Queue, Worker, UnrecoverableError } from "bullmq";

// ─── Webhooks ────────────────────────────────────────────────────────────────
import { createMergeWebhookHandler } from "./webhooks/merge-webhook.js";
import { createGongWebhookHandler } from "./webhooks/gong-webhook.js";
import { createGrainWebhookHandler } from "./webhooks/grain-webhook.js";

// ─── API Routes ──────────────────────────────────────────────────────────────
import { createAuthRoutes } from "./api/auth-routes.js";
import { createRAGRoutes } from "./api/rag-routes.js";
import { createStoryRoutes } from "./api/story-routes.js";
import { createLandingPageRoutes } from "./api/landing-page-routes.js";
import { createExportRoutes } from "./api/export-routes.js";
import { createPublicPageRoutes } from "./api/public-page-renderer.js";
import { createDashboardRoutes } from "./api/dashboard-routes.js";
import { createAdminMetricsRoutes } from "./api/admin-metrics-routes.js";
import { createApiKeyRoutes } from "./api/api-key-routes.js";
import { createMergeRoutes } from "./api/merge-routes.js";
import { createIntegrationRoutes } from "./api/integration-routes.js";
import { createAISettingsRoutes } from "./api/ai-settings-routes.js";
import { createPlatformAdminRoutes } from "./api/platform-admin-routes.js";
import { createTranscriptViewerRoutes } from "./api/transcript-viewer-routes.js";
import { createEntityResolutionRoutes } from "./api/entity-resolution-routes.js";
import { createEditorPageRoutes } from "./api/editor-page-renderer.js";
import { createDashboardPageRoutes } from "./api/dashboard-page-renderer.js";
import { createAdminAccountAccessPage } from "./api/admin-account-access-page.js";
import { createAdminPermissionsPage } from "./api/admin-permissions-page.js";
import { createOrgSettingsRoutes } from "./api/org-settings-routes.js";
import { createIntegrationsRoutes } from "./api/integrations-routes.js";
import { createBillingRoutes } from "./api/billing-routes.js";
import { createApiKeysRoutes } from "./api/api-keys-routes.js";
import { createAccountsRoutes } from "./api/accounts-routes.js";
import { createAccountJourneyRoutes } from "./api/account-journey-routes.js";
import { createAccountMergeRoutes } from "./api/account-merge-routes.js";
import { createChatbotConnectorRoutes } from "./api/chatbot-connector.js";
import { createSetupRoutes } from "./api/setup-routes.js";
import { createNotificationRoutes } from "./api/notification-routes.js";
import { createAnalyticsRoutes } from "./api/analytics-routes.js";

// ─── Middleware ───────────────────────────────────────────────────────────────
import { requireAuth } from "./middleware/auth.js";
import {
  createTrialGate,
  createCheckoutHandler,
  createPortalHandler,
  createStripeWebhookHandler,
  reportUsageToStripe,
} from "./middleware/billing.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import { createApiKeyAuth, requireScope } from "./middleware/api-key-auth.js";
import {
  createRateLimiter,
  apiRateLimiter,
  webhookRateLimiter,
  passwordRateLimiter,
} from "./middleware/rate-limiter.js";
import { createApiUsageLogger } from "./middleware/api-usage-logger.js";

// ─── Services ────────────────────────────────────────────────────────────────
import { AITagger } from "./services/ai-tagger.js";
import { RAGEngine } from "./services/rag-engine.js";
import { StoryBuilder } from "./services/story-builder.js";
import {
  TranscriptProcessor,
  type ProcessCallJob,
} from "./services/transcript-processor.js";
import { AIConfigService } from "./services/ai-config.js";
import { AIUsageTracker } from "./services/ai-usage-tracker.js";
import { MergeApiClient } from "./services/merge-api-client.js";
import {
  TranscriptFetcher,
  TranscriptFetchError,
  transcriptFetchBackoffStrategy,
  type TranscriptFetchJob,
} from "./services/transcript-fetcher.js";
import { startUsageReportingCron } from "./services/usage-reporter.js";
import { NotificationService } from "./services/notification-service.js";
import { EmailService } from "./services/email.js";
import {
  WeeklyStoryRegeneration,
  type WeeklyRegenJobData,
} from "./services/weekly-story-regeneration.js";

// ─── Integrations ────────────────────────────────────────────────────────────
import { createProviderRegistry } from "./integrations/provider-registry.js";
import { SyncEngine } from "./integrations/sync-engine.js";

// ─── Observability ───────────────────────────────────────────────────────────
import logger, { jobStore } from "./lib/logger.js";
import { metrics } from "./lib/metrics.js";
import { initSentry, Sentry } from "./lib/sentry.js";

// ─── Sentry ─────────────────────────────────────────────────────────────────

initSentry();

// ─── Init ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2025-02-24.acacia",
});

const workos = new WorkOS(process.env.WORKOS_API_KEY ?? "");

const openaiApiKey = process.env.OPENAI_API_KEY ?? "";
const pineconeApiKey = process.env.PINECONE_API_KEY ?? "";
const pineconeIndex = process.env.PINECONE_INDEX ?? "storyengine-transcripts";
const mergeApiKey = process.env.MERGE_API_KEY ?? "";

// ─── Services ────────────────────────────────────────────────────────────────

// AI Configuration & Usage
const aiConfigService = new AIConfigService(prisma);
const aiUsageTracker = new AIUsageTracker(prisma, aiConfigService);

// Core AI/ML
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
  ragEngine,
  aiConfigService,
  aiUsageTracker
);

// Notifications & Email
const notificationService = new NotificationService(prisma);
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

// Integration providers
const providerRegistry = createProviderRegistry();
const syncEngine = new SyncEngine(prisma, /* processingQueue set below */ null as any, providerRegistry);

// ─── BullMQ Queues & Workers ────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Call processing queue
const processingQueue = new Queue("call-processing", {
  connection: { url: REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

// Fix sync engine's reference to the processing queue
(syncEngine as any).processingQueue = processingQueue;

// Merge.dev API client
const mergeClient = new MergeApiClient({
  prisma,
  processingQueue,
  mergeApiKey,
});

// Transcript fetch queue
const transcriptFetchQueue = new Queue("transcript-fetching", {
  connection: { url: REDIS_URL },
});

const transcriptFetcher = new TranscriptFetcher({
  prisma,
  processingQueue,
  mergeApiKey,
});

const transcriptFetchWorker = new Worker<TranscriptFetchJob>(
  "transcript-fetching",
  async (job) => {
    try {
      await transcriptFetcher.fetchTranscript(job.data);
    } catch (err) {
      if (err instanceof TranscriptFetchError && !err.retryable) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 2,
    settings: {
      backoffStrategy: transcriptFetchBackoffStrategy as (...args: any[]) => number,
    },
  }
);

// Integration sync queue
const syncQueue = new Queue("integration-sync", {
  connection: { url: REDIS_URL },
});

const SYNC_INTERVAL_MS =
  parseInt(process.env.SYNC_INTERVAL_MINUTES ?? "15", 10) * 60 * 1000;

syncQueue.upsertJobScheduler(
  "periodic-sync",
  { every: SYNC_INTERVAL_MS },
  { name: "sync-all-integrations" }
);

const syncWorker = new Worker(
  "integration-sync",
  async () => {
    await syncEngine.syncAll();
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1,
  }
);

// Story regeneration queue
const storyRegenQueue = new Queue<WeeklyRegenJobData>("story-regeneration", {
  connection: { url: REDIS_URL },
});

storyRegenQueue.upsertJobScheduler(
  "weekly-story-regen",
  { pattern: "0 2 * * 0" }, // every Sunday at 02:00 UTC
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
    logger.info(`Starting weekly story regeneration job ${job.id}`);
    const result = await weeklyStoryRegen.run(job.data);
    logger.info(
      `Story regen job ${job.id} done: ${result.accountsProcessed} accounts, ${result.orgsNotified} orgs, ${result.errors.length} errors`
    );
    return result;
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1,
  }
);

// Call processing worker
const callWorker = new Worker<ProcessCallJob>(
  "call-processing",
  async (job) => {
    const ctx = {
      jobId: job.id ?? "unknown",
      callId: job.data.callId,
      organizationId: job.data.organizationId,
      accountId: job.data.accountId,
    };

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

callWorker.on("completed", async (job) => {
  logger.info("Job completed", {
    jobId: job.id,
    callId: job.data.callId,
  });
  if (notificationService && job.data.organizationId) {
    await notificationService
      .notifyCallProcessed(job.data.organizationId, job.data.callId)
      .catch((err: Error) => logger.error("Notification error:", { error: err.message }));
  }
});

callWorker.on("failed", async (job, err) => {
  logger.error("Job failed", {
    jobId: job?.id,
    callId: job?.data.callId,
    error: err.message,
    stack: err.stack,
  });
  Sentry.captureException(err, {
    tags: { jobId: job?.id, callId: job?.data.callId },
  });
  if (notificationService && job?.data?.organizationId) {
    notificationService
      .notifyCallProcessingFailed(job.data.organizationId, job.data.callId, err.message)
      .catch((notifErr: Error) => logger.error("Notification error:", { error: notifErr.message }));
  }
});

// Usage reporting cron
const usageCron = startUsageReportingCron(prisma, stripe);

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// Sentry request handler (must be first middleware)
Sentry.setupExpressErrorHandler(app);

// Global middleware
app.use(helmet());

const allowedOrigins = process.env.APP_URL
  ? [process.env.APP_URL]
  : ["http://localhost:3000"];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Request ID tracing (before any route handlers)
app.use(requestIdMiddleware);

// Stripe webhooks need raw body
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  webhookRateLimiter,
  createStripeWebhookHandler(prisma, stripe)
);

// All other routes use JSON parsing
app.use(express.json({ limit: "10mb" }));

// Request logging (after body parsing so we can log status codes)
app.use(requestLoggingMiddleware);

// ─── Public Routes ───────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "storyengine", version: "1.0.0" });
});

// Webhook endpoints (authenticated by signature, not user auth)
app.post(
  "/api/webhooks/merge",
  webhookRateLimiter,
  createMergeWebhookHandler({ prisma, processingQueue })
);

app.post(
  "/api/webhooks/gong",
  webhookRateLimiter,
  createGongWebhookHandler({ prisma, processingQueue })
);

app.post(
  "/api/webhooks/grain",
  webhookRateLimiter,
  createGrainWebhookHandler({ prisma, processingQueue })
);

// Public landing pages — no auth, served at /s/:slug
app.use("/s", passwordRateLimiter, createPublicPageRoutes(prisma));

// ─── Admin Metrics ───────────────────────────────────────────────────────────
app.use("/api/admin/metrics", createAdminMetricsRoutes(prisma));

// ─── Public API (API-key authenticated, for third-party chatbot consumers) ──

const apiKeyAuth = createApiKeyAuth(prisma);
const publicApiRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60_000,
});
const apiUsageLogger = createApiUsageLogger(prisma);

app.use(
  "/api/v1/rag",
  apiKeyAuth,
  requireScope("rag:query"),
  publicApiRateLimiter,
  apiUsageLogger,
  createRAGRoutes(ragEngine, prisma)
);

// ─── Platform Admin (API-key protected, no user auth) ────────────────────────
app.use("/api/platform", createPlatformAdminRoutes(aiConfigService));

// ─── Auth Routes (public — no JWT required) ─────────────────────────────────
app.use("/api/auth", createAuthRoutes(prisma, workos));

// ─── Setup Wizard (before auth — needed for first-run onboarding) ────────────
app.use("/api/setup", createSetupRoutes(prisma, stripe));

// ─── Authenticated Routes ────────────────────────────────────────────────────
// requireAuth middleware verifies JWT and sets req.organizationId, req.userId, req.userRole.
app.use(requireAuth);

const trialGate = createTrialGate(prisma, stripe);

// Billing
app.post("/api/billing/checkout", createCheckoutHandler(prisma, stripe));
app.post("/api/billing/portal", createPortalHandler(prisma, stripe));

// API Key Management (behind auth + trial gate)
app.use("/api/keys", trialGate, createApiKeyRoutes(prisma));

// RAG Chatbot Connector — internal use (behind trial gate)
app.use("/api/rag", trialGate, apiRateLimiter, createRAGRoutes(ragEngine, prisma));

// Story Builder (behind trial gate)
app.use("/api/stories", trialGate, apiRateLimiter, createStoryRoutes(storyBuilder, prisma));

// Landing Pages — CRUD, edit, publish, share (behind trial gate)
app.use("/api/pages", trialGate, apiRateLimiter, createLandingPageRoutes(prisma));

// Landing Page Exports — PDF, Google Doc, Slack (behind trial gate)
app.use("/api/pages", trialGate, createExportRoutes(prisma));

// Dashboard — stats, page list, admin settings, permissions, account access
app.use("/api/dashboard", trialGate, apiRateLimiter, createDashboardRoutes(prisma));

// Transcript Viewer
app.use("/api/calls", trialGate, createTranscriptViewerRoutes(prisma));

// Entity Resolution Queue
app.use("/api/entity-resolution", trialGate, createEntityResolutionRoutes(prisma));

// Accounts — list, journey timeline, merge tool
app.use("/api/accounts", trialGate, createAccountsRoutes(prisma));
app.use("/api/accounts", trialGate, createAccountJourneyRoutes(prisma));
app.use("/api/accounts", trialGate, createAccountMergeRoutes(prisma));

// Merge.dev integration
app.use("/api/merge", trialGate, createMergeRoutes(mergeClient, prisma));

// Direct integrations (Grain, Gong, Salesforce)
app.use("/api/integrations", trialGate, createIntegrationRoutes(prisma, providerRegistry, syncEngine));

// AI Settings
app.use("/api/ai", trialGate, createAISettingsRoutes(prisma, aiConfigService, aiUsageTracker));

// Notifications
app.use("/api/notifications", trialGate, createNotificationRoutes(notificationService));

// Analytics Dashboard
app.use("/api/analytics", trialGate, createAnalyticsRoutes(prisma));

// Admin Settings Pages
app.use("/api/settings/org", trialGate, createOrgSettingsRoutes(prisma));
app.use("/api/settings/integrations", trialGate, createIntegrationsRoutes(prisma));
app.use("/api/settings/billing", trialGate, createBillingRoutes(prisma, stripe));
app.use("/api/settings/api-keys", trialGate, createApiKeysRoutes(prisma));

// Admin UI Pages (server-rendered)
app.use("/admin/account-access", trialGate, createAdminAccountAccessPage(prisma));
app.use("/admin/permissions", trialGate, createAdminPermissionsPage(prisma));

// Editor & Dashboard Pages (server-rendered)
app.use("/editor", trialGate, createEditorPageRoutes(prisma));
app.use("/dashboard", trialGate, createDashboardPageRoutes(prisma));

// Chatbot Connector UI
app.use("/chat", trialGate, createChatbotConnectorRoutes());

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  logger.info(`StoryEngine listening on port ${PORT}`, {
    endpoints: {
      health: `http://localhost:${PORT}/api/health`,
      auth: `http://localhost:${PORT}/api/auth/login`,
      rag: `http://localhost:${PORT}/api/rag/query`,
      publicRag: `http://localhost:${PORT}/api/v1/rag/query`,
      apiKeys: `http://localhost:${PORT}/api/keys`,
      stories: `http://localhost:${PORT}/api/stories/build`,
      pages: `http://localhost:${PORT}/api/pages`,
      exports: `http://localhost:${PORT}/api/pages/:id/export`,
      dashboard: `http://localhost:${PORT}/api/dashboard`,
      analytics: `http://localhost:${PORT}/api/analytics/dashboard`,
      calls: `http://localhost:${PORT}/api/calls`,
      entityResolution: `http://localhost:${PORT}/api/entity-resolution`,
      accounts: `http://localhost:${PORT}/api/accounts`,
      merge: `http://localhost:${PORT}/api/merge`,
      integrations: `http://localhost:${PORT}/api/integrations`,
      aiSettings: `http://localhost:${PORT}/api/ai/providers`,
      platform: `http://localhost:${PORT}/api/platform/providers`,
      notifications: `http://localhost:${PORT}/api/notifications`,
      settings: `http://localhost:${PORT}/api/settings/org`,
      setup: `http://localhost:${PORT}/api/setup/status`,
      editor: `http://localhost:${PORT}/editor/:pageId`,
      dashboardUI: `http://localhost:${PORT}/dashboard/pages`,
      chat: `http://localhost:${PORT}/chat`,
      public: `http://localhost:${PORT}/s/:slug`,
      webhookMerge: `http://localhost:${PORT}/api/webhooks/merge`,
      webhookGong: `http://localhost:${PORT}/api/webhooks/gong`,
      webhookGrain: `http://localhost:${PORT}/api/webhooks/grain`,
      metrics: `http://localhost:${PORT}/api/admin/metrics`,
    },
  });

  // Start Merge.dev polling if API key is configured
  if (mergeApiKey) {
    mergeClient.startPolling();
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  usageCron.stop();
  mergeClient.stopPolling();
  await callWorker.close();
  await transcriptFetchWorker.close();
  await syncWorker.close();
  await storyRegenWorker.close();
  await processingQueue.close();
  await transcriptFetchQueue.close();
  await syncQueue.close();
  await storyRegenQueue.close();
  await shutdownOtel();
  await prisma.$disconnect();
  process.exit(0);
});
