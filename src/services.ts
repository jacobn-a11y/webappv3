/**
 * Service Dependency Graph
 *
 * Creates and wires together all application services. Services are grouped
 * by domain: AI/ML, notifications, integrations, and transcript processing.
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";

import { AITagger } from "./services/ai-tagger.js";
import { RAGEngine } from "./services/rag-engine.js";
import { StoryBuilder } from "./services/story-builder.js";
import { TranscriptProcessor } from "./services/transcript-processor.js";
import { AIConfigService } from "./services/ai-config.js";
import { AIUsageTracker } from "./services/ai-usage-tracker.js";
import { MergeApiClient } from "./services/merge-api-client.js";
import { TranscriptFetcher } from "./services/transcript-fetcher.js";
import { NotificationService } from "./services/notification-service.js";
import { EmailService } from "./services/email.js";
import { WeeklyStoryRegeneration } from "./services/weekly-story-regeneration.js";
import { createProviderRegistry } from "./integrations/provider-registry.js";
import { SyncEngine } from "./integrations/sync-engine.js";

export interface ServiceConfig {
  openaiApiKey: string;
  pineconeApiKey: string;
  pineconeIndex: string;
  mergeApiKey: string;
  resendApiKey: string;
  regenFromEmail: string;
  appUrl: string;
}

export interface Services {
  aiConfigService: AIConfigService;
  aiUsageTracker: AIUsageTracker;
  aiTagger: AITagger;
  ragEngine: RAGEngine;
  storyBuilder: StoryBuilder;
  transcriptProcessor: TranscriptProcessor;
  notificationService: NotificationService;
  emailService: EmailService;
  weeklyStoryRegen: WeeklyStoryRegeneration;
  providerRegistry: ReturnType<typeof createProviderRegistry>;
  syncEngine: SyncEngine;
  mergeClient: MergeApiClient;
  transcriptFetcher: TranscriptFetcher;
}

export function createServices(
  prisma: PrismaClient,
  processingQueue: Queue,
  config: ServiceConfig
): Services {
  // AI Configuration & Usage
  const aiConfigService = new AIConfigService(prisma);
  const aiUsageTracker = new AIUsageTracker(prisma, aiConfigService);

  // Core AI/ML
  const aiTagger = new AITagger(prisma, config.openaiApiKey);
  const ragEngine = new RAGEngine(prisma, {
    openaiApiKey: config.openaiApiKey,
    pineconeApiKey: config.pineconeApiKey,
    pineconeIndex: config.pineconeIndex,
  });
  const storyBuilder = new StoryBuilder(prisma, config.openaiApiKey);
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
    config.resendApiKey,
    config.regenFromEmail,
    config.appUrl
  );
  const weeklyStoryRegen = new WeeklyStoryRegeneration(
    prisma,
    storyBuilder,
    emailService
  );

  // Integration providers
  const providerRegistry = createProviderRegistry();
  const syncEngine = new SyncEngine(prisma, processingQueue, providerRegistry);

  // Merge.dev API client
  const mergeClient = new MergeApiClient({
    prisma,
    processingQueue,
    mergeApiKey: config.mergeApiKey,
  });

  // Transcript fetcher
  const transcriptFetcher = new TranscriptFetcher({
    prisma,
    processingQueue,
    mergeApiKey: config.mergeApiKey,
  });

  return {
    aiConfigService,
    aiUsageTracker,
    aiTagger,
    ragEngine,
    storyBuilder,
    transcriptProcessor,
    notificationService,
    emailService,
    weeklyStoryRegen,
    providerRegistry,
    syncEngine,
    mergeClient,
    transcriptFetcher,
  };
}
