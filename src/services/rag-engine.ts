/**
 * RAG (Retrieval-Augmented Generation) Engine
 *
 * Powers the "Chatbot Connector" — a third-party chatbot can query this
 * endpoint with natural language questions about an account, and receive
 * grounded answers backed by real transcript segments from Pinecone.
 *
 * Flow:
 *   1. Receive query + account context
 *   2. Generate embedding for the query (always OpenAI text-embedding-3-small)
 *   3. Search Pinecone for relevant transcript chunks (filtered by account)
 *   4. Build a context window from top-K results
 *   5. Send query + context to the caller's chosen AI model
 *   6. Return answer with source citations
 *
 * Embeddings remain OpenAI-only because existing Pinecone vectors are
 * OpenAI-based. Switching embedding models would require re-indexing.
 * Chat completions use the AIClient abstraction for provider flexibility.
 */

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { PrismaClient } from "@prisma/client";
import type { AIClient } from "./ai-client.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RAGQuery {
  query: string;
  accountId: string;
  organizationId: string;
  /** Max chunks to retrieve. Defaults to 8. */
  topK?: number;
  /** Filter to specific funnel stages. */
  funnelStages?: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RAGChatQuery {
  query: string;
  accountId: string | null;
  organizationId: string;
  /** Previous messages for conversation context. */
  history: ChatMessage[];
  topK?: number;
  funnelStages?: string[];
}

export interface RAGChatResponse {
  answer: string;
  sources: RAGSource[];
  tokensUsed: number;
}

export interface RAGResponse {
  answer: string;
  sources: RAGSource[];
  tokensUsed: number;
}

export interface RAGSource {
  chunkId: string;
  callId: string;
  callTitle: string | null;
  callDate: string;
  text: string;
  speaker: string | null;
  relevanceScore: number;
}

// ─── RAG Engine ──────────────────────────────────────────────────────────────

export class RAGEngine {
  private openai: OpenAI;
  private pinecone: Pinecone;
  private prisma: PrismaClient;
  private indexName: string;

  constructor(
    prisma: PrismaClient,
    config: {
      openaiApiKey: string;
      pineconeApiKey: string;
      pineconeIndex: string;
    }
  ) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
    this.prisma = prisma;
    this.indexName = config.pineconeIndex;
  }

  /**
   * Main query method: takes a natural language question, retrieves relevant
   * transcript chunks, and returns a grounded answer.
   *
   * @param input - The query parameters
   * @param aiClient - The AI client to use for chat completion (may be TrackedAIClient)
   */
  async query(input: RAGQuery, aiClient: AIClient): Promise<RAGResponse> {
    const topK = input.topK ?? 8;

    // ── Step 1: Generate query embedding ─────────────────────────────
    const queryEmbedding = await this.embed(input.query);

    // ── Step 2: Search Pinecone ──────────────────────────────────────
    const index = this.pinecone.Index(this.indexName);

    const filter: Record<string, unknown> = {
      account_id: input.accountId,
      organization_id: input.organizationId,
    };
    if (input.funnelStages && input.funnelStages.length > 0) {
      filter.funnel_stage = { $in: input.funnelStages };
    }

    const searchResults = await index.query({
      vector: queryEmbedding,
      topK,
      filter,
      includeMetadata: true,
    });

    // ── Step 3: Hydrate sources from PostgreSQL ──────────────────────
    const sources = await this.hydrateSources(searchResults.matches ?? []);

    if (sources.length === 0) {
      return {
        answer:
          "I couldn't find any relevant transcript segments for this account matching your query.",
        sources: [],
        tokensUsed: 0,
      };
    }

    // ── Step 4: Build context and generate answer ────────────────────
    const contextBlock = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}] Call: "${s.callTitle ?? "Untitled"}" (${s.callDate})${s.speaker ? ` — ${s.speaker}` : ""}\n${s.text}`
      )
      .join("\n\n---\n\n");

    const result = await aiClient.chatCompletion({
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that answers questions about customer accounts based on call transcript data.

RULES:
1. ONLY use information from the provided transcript sources.
2. Cite sources using [Source N] notation.
3. If the sources don't contain enough information to answer, say so honestly.
4. Be specific and include any quantified metrics you find.
5. Keep answers concise but complete.`,
        },
        {
          role: "user",
          content: `QUESTION: ${input.query}

TRANSCRIPT SOURCES:
${contextBlock}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 1500,
    });

    return {
      answer: result.content || "Unable to generate an answer.",
      sources,
      tokensUsed: result.totalTokens,
    };
  }

  /**
   * Conversation-aware chat: retrieves context for the latest query while
   * carrying prior conversation history so the LLM can resolve follow-ups.
   * When accountId is null, searches across all accounts in the org.
   */
  async chat(input: RAGChatQuery): Promise<RAGChatResponse> {
    const topK = input.topK ?? 8;

    // ── Step 1: Generate query embedding ─────────────────────────────
    const queryEmbedding = await this.embed(input.query);

    // ── Step 2: Search Pinecone ──────────────────────────────────────
    const index = this.pinecone.Index(this.indexName);

    const filter: Record<string, unknown> = {
      organization_id: input.organizationId,
    };
    if (input.accountId) {
      filter.account_id = input.accountId;
    }
    if (input.funnelStages && input.funnelStages.length > 0) {
      filter.funnel_stage = { $in: input.funnelStages };
    }

    const searchResults = await index.query({
      vector: queryEmbedding,
      topK,
      filter,
      includeMetadata: true,
    });

    // ── Step 3: Hydrate sources from PostgreSQL ──────────────────────
    const sources = await this.hydrateSources(searchResults.matches ?? []);

    if (sources.length === 0) {
      return {
        answer:
          "I couldn't find any relevant transcript segments matching your query.",
        sources: [],
        tokensUsed: 0,
      };
    }

    // ── Step 4: Build context and generate answer with history ───────
    const contextBlock = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}] Call: "${s.callTitle ?? "Untitled"}" (${s.callDate})${s.speaker ? ` — ${s.speaker}` : ""}\n${s.text}`
      )
      .join("\n\n---\n\n");

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: `You are a helpful assistant that answers questions about customer accounts based on call transcript data.

RULES:
1. ONLY use information from the provided transcript sources.
2. Cite sources using [Source N] notation.
3. If the sources don't contain enough information to answer, say so honestly.
4. Be specific and include any quantified metrics you find.
5. Keep answers concise but complete.
6. When the user asks follow-up questions, use the conversation history for context.`,
      },
    ];

    // Inject prior conversation turns
    for (const msg of input.history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Current query with fresh context
    messages.push({
      role: "user",
      content: `QUESTION: ${input.query}

TRANSCRIPT SOURCES:
${contextBlock}`,
    });

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      max_tokens: 1500,
      messages,
    });

    const answer =
      response.choices[0]?.message?.content ?? "Unable to generate an answer.";
    const tokensUsed = response.usage?.total_tokens ?? 0;

    return { answer, sources, tokensUsed };
  }

  /**
   * Generates an embedding for a transcript chunk and upserts it to Pinecone.
   * Called during the ingestion pipeline after chunking + tagging.
   * Always uses OpenAI embeddings for vector consistency.
   */
  async indexChunk(chunk: {
    chunkId: string;
    text: string;
    accountId: string;
    organizationId: string;
    callId: string;
    funnelStages: string[];
    topics: string[];
  }): Promise<string> {
    const embedding = await this.embed(chunk.text);
    const index = this.pinecone.Index(this.indexName);

    const vectorId = `chunk_${chunk.chunkId}`;

    await index.upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: {
          chunk_id: chunk.chunkId,
          account_id: chunk.accountId,
          organization_id: chunk.organizationId,
          call_id: chunk.callId,
          funnel_stages: chunk.funnelStages,
          topics: chunk.topics,
          text_preview: chunk.text.slice(0, 200),
        },
      },
    ]);

    // Update the chunk record with the Pinecone vector ID
    await this.prisma.transcriptChunk.update({
      where: { id: chunk.chunkId },
      data: { embeddingId: vectorId },
    });

    return vectorId;
  }

  // ─── Private ──────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }

  private async hydrateSources(
    matches: Array<{
      id: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<RAGSource[]> {
    const chunkIds = matches
      .map((m) => m.metadata?.chunk_id as string | undefined)
      .filter((id): id is string => !!id);

    if (chunkIds.length === 0) return [];

    const chunks = await this.prisma.transcriptChunk.findMany({
      where: { id: { in: chunkIds } },
      include: {
        transcript: {
          include: {
            call: { select: { id: true, title: true, occurredAt: true } },
          },
        },
      },
    });

    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    const sources: RAGSource[] = [];
    for (const match of matches) {
      const chunkId = match.metadata?.chunk_id as string | undefined;
      if (!chunkId) continue;

      const chunk = chunkMap.get(chunkId);
      if (!chunk) continue;

      sources.push({
        chunkId: chunk.id,
        callId: chunk.transcript.call.id,
        callTitle: chunk.transcript.call.title,
        callDate: chunk.transcript.call.occurredAt.toISOString().split("T")[0],
        text: chunk.text,
        speaker: chunk.speaker,
        relevanceScore: match.score ?? 0,
      });
    }

    return sources;
  }
}
