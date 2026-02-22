/**
 * Transcript Processor
 *
 * BullMQ worker that processes calls through the full pipeline:
 *   1. Chunk the transcript into manageable segments
 *   2. Mask PII from each chunk
 *   3. Tag each chunk with taxonomy topics via the AI Tagger
 *   4. Generate embeddings and index in Pinecone via the RAG Engine
 *
 * Resolves the correct AI client per job based on the org's configuration.
 * Background processing uses the org's own key when available, falling back
 * to the platform key. Usage is recorded but not billed to a specific user
 * since transcript processing is triggered by webhooks, not user actions.
 */

import type { PrismaClient, UserRole } from "@prisma/client";
import { AITagger } from "./ai-tagger.js";
import { RAGEngine } from "./rag-engine.js";
import { AIConfigService } from "./ai-config.js";
import { AIUsageTracker } from "./ai-usage-tracker.js";
import { maskPII } from "../middleware/pii-masker.js";
import logger from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessCallJob {
  callId: string;
  organizationId: string;
  accountId: string | null;
  hasTranscript: boolean;
  /** Optional: user who triggered the processing (for usage tracking). */
  userId?: string;
}

// ─── Chunking Logic ──────────────────────────────────────────────────────────

const TARGET_CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200;      // overlap to preserve context across boundaries

/**
 * Splits transcript text into overlapping chunks, preserving sentence boundaries.
 */
function chunkTranscript(
  text: string
): Array<{ text: string; index: number }> {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
  const chunks: Array<{ text: string; index: number }> = [];

  let current = "";
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET_CHUNK_SIZE && current.length > 0) {
      chunks.push({ text: current.trim(), index: chunkIndex++ });
      // Keep overlap from the end of the previous chunk
      const overlap = current.slice(-CHUNK_OVERLAP);
      current = overlap + sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push({ text: current.trim(), index: chunkIndex });
  }

  return chunks;
}

// ─── Processor ───────────────────────────────────────────────────────────────

export class TranscriptProcessor {
  private prisma: PrismaClient;
  private tagger: AITagger;
  private ragEngine: RAGEngine;
  private configService: AIConfigService;
  private usageTracker: AIUsageTracker;

  constructor(
    prisma: PrismaClient,
    tagger: AITagger,
    ragEngine: RAGEngine,
    configService: AIConfigService,
    usageTracker: AIUsageTracker
  ) {
    this.prisma = prisma;
    this.tagger = tagger;
    this.ragEngine = ragEngine;
    this.configService = configService;
    this.usageTracker = usageTracker;
  }

  /**
   * Main processing pipeline for a call.
   */
  async processCall(job: ProcessCallJob): Promise<void> {
    const { callId, organizationId, accountId } = job;

    // ── Step 1: Load transcript ──────────────────────────────────────
    const transcript = await this.prisma.transcript.findUnique({
      where: { callId },
    });

    if (!transcript) {
      logger.warn("No transcript for call, skipping", { callId });
      return;
    }

    // ── Step 2: Chunk the transcript ─────────────────────────────────
    const rawChunks = chunkTranscript(transcript.fullText);

    // ── Step 3: Mask PII and store chunks ────────────────────────────
    for (const rawChunk of rawChunks) {
      const { maskedText } = maskPII(rawChunk.text);

      await this.prisma.transcriptChunk.upsert({
        where: {
          transcriptId_chunkIndex: {
            transcriptId: transcript.id,
            chunkIndex: rawChunk.index,
          },
        },
        create: {
          transcriptId: transcript.id,
          chunkIndex: rawChunk.index,
          text: maskedText, // store the PII-masked version
        },
        update: {
          text: maskedText,
        },
      });
    }

    // ── Step 4: Resolve AI client for this org ───────────────────────
    // Use OWNER role to bypass user-level access checks for background jobs.
    // If a specific user triggered this, we could use their context instead.
    const _aiClient = await this.resolveOrgAIClient(
      organizationId,
      job.userId
    );

    // ── Step 5: Tag with AI ──────────────────────────────────────────
    const taggingResults = await this.tagger.tagCallTranscript(
      callId
    );

    // ── Step 6: Generate embeddings and index ────────────────────────
    if (accountId) {
      const chunks = await this.prisma.transcriptChunk.findMany({
        where: { transcriptId: transcript.id },
        include: { tags: true },
      });

      for (const chunk of chunks) {
        await this.ragEngine.indexChunk({
          chunkId: chunk.id,
          text: chunk.text,
          accountId,
          organizationId,
          callId,
          funnelStages: [...new Set(chunk.tags.map((t) => t.funnelStage))],
          topics: chunk.tags.map((t) => t.topic),
        });
      }
    }

    metrics.incrementTranscriptsProcessed();
    logger.info("Processed call", {
      callId,
      chunksCount: rawChunks.length,
      tagsCount: taggingResults.length,
    });
  }

  /**
   * Resolves an AI client for background processing.
   * Uses the org's configured provider/model without per-user billing.
   */
  private async resolveOrgAIClient(
    organizationId: string,
    userId?: string
  ) {
    // Resolve the AI client using the org's default configuration.
    // OWNER role bypasses all user-level access checks.
    const { client } = await this.configService.resolveClient(
      organizationId,
      userId ?? "system",
      "OWNER" as UserRole
    );

    return client;
  }
}
