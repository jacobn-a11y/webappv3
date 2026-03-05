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

export interface RAGSource {
  chunkId: string;
  callId: string;
  callTitle: string | null;
  callDate: string;
  text: string;
  speaker: string | null;
  relevanceScore: number;
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
