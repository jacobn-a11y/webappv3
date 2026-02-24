/**
 * RAG (Retrieval-Augmented Generation) Engine
 *
 * Powers the "Chatbot Connector" — a third-party chatbot can query this
 * endpoint with natural language questions about an account, and receive
 * grounded answers backed by real transcript segments from Pinecone.
 *
 * Flow:
 *   1. Receive query + account context
 *   2. Generate embedding for the query
 *   3. Search Pinecone for relevant transcript chunks (filtered by account)
 *   4. Build a context window from top-K results
 *   5. Send query + context to LLM for grounded answer
 *   6. Return answer with source citations
 */

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";

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
  private model: string;
  private queryCache = new Map<string, { value: RAGResponse; expiresAt: number }>();
  private chatCache = new Map<string, { value: RAGChatResponse; expiresAt: number }>();
  private cacheTtlMs: number;
  private maxCacheEntries: number;
  private vectorRetentionDeleteLimit: number;

  constructor(
    prisma: PrismaClient,
    config: {
      openaiApiKey: string;
      pineconeApiKey: string;
      pineconeIndex: string;
      model?: string;
    }
  ) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
    this.prisma = prisma;
    this.indexName = config.pineconeIndex;
    this.model = config.model ?? "gpt-4o";
    this.cacheTtlMs = resolvePositiveInt(process.env.RAG_QUERY_CACHE_TTL_SECONDS, 90) * 1000;
    this.maxCacheEntries = resolvePositiveInt(process.env.RAG_QUERY_CACHE_MAX_ENTRIES, 500);
    this.vectorRetentionDeleteLimit = resolvePositiveInt(
      process.env.RAG_VECTOR_RETENTION_DELETE_LIMIT,
      1000
    );
  }

  /**
   * Main query method: takes a natural language question, retrieves relevant
   * transcript chunks, and returns a grounded answer.
   */
  async query(input: RAGQuery): Promise<RAGResponse> {
    const topK = input.topK ?? 8;
    const cacheKey = this.buildQueryCacheKey(input, topK);
    const cached = this.getCacheEntry(this.queryCache, cacheKey);
    if (cached) {
      return cached;
    }

    // ── Step 1: Generate query embedding ─────────────────────────────
    const queryEmbedding = await this.embed(input.query);

    // ── Step 2: Search Pinecone ──────────────────────────────────────
    const index = this.pinecone.Index(this.indexName);

    const filter: Record<string, unknown> = {
      account_id: input.accountId,
      organization_id: input.organizationId,
    };
    if (input.funnelStages && input.funnelStages.length > 0) {
      filter.funnel_stages = { $in: input.funnelStages };
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
      const empty: RAGResponse = {
        answer:
          "I couldn't find any relevant transcript segments for this account matching your query.",
        sources: [],
        tokensUsed: 0,
      };
      this.setCacheEntry(this.queryCache, cacheKey, empty);
      return empty;
    }

    // ── Step 4: Build context and generate answer ────────────────────
    const contextBlock = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}] Call: "${s.callTitle ?? "Untitled"}" (${s.callDate})${s.speaker ? ` — ${s.speaker}` : ""}\n${s.text}`
      )
      .join("\n\n---\n\n");

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      max_tokens: 1500,
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
    });

    const answer =
      response.choices[0]?.message?.content ?? "Unable to generate an answer.";
    const tokensUsed = response.usage?.total_tokens ?? 0;

    const result: RAGResponse = { answer, sources, tokensUsed };
    this.setCacheEntry(this.queryCache, cacheKey, result);
    return result;
  }

  /**
   * Conversation-aware chat: retrieves context for the latest query while
   * carrying prior conversation history so the LLM can resolve follow-ups.
   * When accountId is null, searches across all accounts in the org.
   */
  async chat(input: RAGChatQuery): Promise<RAGChatResponse> {
    const topK = input.topK ?? 8;
    const cacheKey = this.buildChatCacheKey(input, topK);
    const cached = this.getCacheEntry(this.chatCache, cacheKey);
    if (cached) {
      return cached;
    }

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
      filter.funnel_stages = { $in: input.funnelStages };
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
      const empty: RAGChatResponse = {
        answer:
          "I couldn't find any relevant transcript segments matching your query.",
        sources: [],
        tokensUsed: 0,
      };
      this.setCacheEntry(this.chatCache, cacheKey, empty);
      return empty;
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

    const result: RAGChatResponse = { answer, sources, tokensUsed };
    this.setCacheEntry(this.chatCache, cacheKey, result);
    return result;
  }

  /**
   * Generates an embedding for a transcript chunk and upserts it to Pinecone.
   * Called during the ingestion pipeline after chunking + tagging.
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

  async pruneVectors(input: {
    organizationId: string;
    olderThan: Date;
    limit?: number;
  }): Promise<number> {
    const limit = Math.max(1, input.limit ?? this.vectorRetentionDeleteLimit);
    const candidates = await this.prisma.transcriptChunk.findMany({
      where: {
        embeddingId: { not: null },
        transcript: {
          call: {
            organizationId: input.organizationId,
            occurredAt: { lt: input.olderThan },
          },
        },
      },
      select: {
        id: true,
        embeddingId: true,
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    const vectorIds = candidates
      .map((chunk) => chunk.embeddingId)
      .filter((value): value is string => !!value);
    if (vectorIds.length === 0) {
      return 0;
    }

    const index = this.pinecone.Index(this.indexName);
    for (let i = 0; i < vectorIds.length; i += 100) {
      const batch = vectorIds.slice(i, i + 100);
      if (batch.length === 0) continue;
      await index.deleteMany(batch);
    }

    await this.prisma.transcriptChunk.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { embeddingId: null },
    });

    return vectorIds.length;
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
    const chunkIds = Array.from(
      new Set(
        matches
          .map((match) => match.metadata?.chunk_id as string | undefined)
          .filter((value): value is string => !!value)
      )
    );
    if (chunkIds.length === 0) {
      return [];
    }

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
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    const sources: RAGSource[] = [];
    for (const match of matches) {
      const chunkId = match.metadata?.chunk_id as string | undefined;
      if (!chunkId) continue;
      const chunk = chunkById.get(chunkId);
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

  private buildQueryCacheKey(input: RAGQuery, topK: number): string {
    return hashCacheKey(
      "query",
      input.organizationId,
      input.accountId,
      String(topK),
      normalizeQueryKey(input.query),
      normalizeArrayKey(input.funnelStages)
    );
  }

  private buildChatCacheKey(input: RAGChatQuery, topK: number): string {
    return hashCacheKey(
      "chat",
      input.organizationId,
      input.accountId ?? "all",
      String(topK),
      normalizeQueryKey(input.query),
      normalizeArrayKey(input.funnelStages),
      normalizeHistoryKey(input.history)
    );
  }

  private getCacheEntry<T>(
    cache: Map<string, { value: T; expiresAt: number }>,
    key: string
  ): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCacheEntry<T>(
    cache: Map<string, { value: T; expiresAt: number }>,
    key: string,
    value: T
  ) {
    if (cache.size >= this.maxCacheEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
  }
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeArrayKey(values?: string[]): string {
  if (!values || values.length === 0) return "";
  return [...values].map((v) => v.trim()).filter(Boolean).sort().join("|");
}

function normalizeHistoryKey(history: ChatMessage[]): string {
  if (!history || history.length === 0) return "";
  return history
    .map((item) => `${item.role}:${normalizeQueryKey(item.content)}`)
    .join("::");
}

function hashCacheKey(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("||")).digest("hex");
}

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
