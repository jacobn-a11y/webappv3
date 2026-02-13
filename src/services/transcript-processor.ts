/**
 * Transcript Processor
 *
 * BullMQ worker that processes calls through the full pipeline:
 *   1. Chunk the transcript into manageable segments
 *   2. Mask PII from each chunk
 *   3. Tag each chunk with taxonomy topics via the AI Tagger
 *   4. Generate embeddings and index in Pinecone via the RAG Engine
 */

import type { PrismaClient } from "@prisma/client";
import { AITagger } from "./ai-tagger.js";
import { RAGEngine } from "./rag-engine.js";
import { maskPII } from "../middleware/pii-masker.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessCallJob {
  callId: string;
  organizationId: string;
  accountId: string | null;
  hasTranscript: boolean;
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

  constructor(
    prisma: PrismaClient,
    tagger: AITagger,
    ragEngine: RAGEngine
  ) {
    this.prisma = prisma;
    this.tagger = tagger;
    this.ragEngine = ragEngine;
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
      console.warn(`No transcript for call ${callId}, skipping`);
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

    // ── Step 4: Tag with AI ──────────────────────────────────────────
    const taggingResults = await this.tagger.tagCallTranscript(callId);

    // ── Step 5: Generate embeddings and index ────────────────────────
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

    console.log(
      `Processed call ${callId}: ${rawChunks.length} chunks, ${taggingResults.length} tagged`
    );
  }
}
