import crypto from "crypto";
import type { ChatMessage, RAGChatQuery, RAGQuery } from "./rag-types.js";

export function buildRagQueryCacheKey(input: RAGQuery, topK: number): string {
  return hashCacheKey(
    "query",
    input.organizationId,
    input.accountId,
    String(topK),
    normalizeQueryKey(input.query),
    normalizeArrayKey(input.funnelStages)
  );
}

export function buildRagChatCacheKey(input: RAGChatQuery, topK: number): string {
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

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeArrayKey(values?: string[]): string {
  if (!values || values.length === 0) return "";
  return [...values].map((value) => value.trim()).filter(Boolean).sort().join("|");
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
