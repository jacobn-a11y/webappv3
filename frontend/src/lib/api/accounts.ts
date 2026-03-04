import type {
  AccountSearchResult,
  AccountsListResponse,
  ChatAccount,
  ChatSource,
  JourneyAccount,
  JourneyTimelineNode,
} from "./types";
import { request } from "./http";

export async function getAccountsList(params?: {
  search?: string;
  funnel_stage?: string;
  page?: number;
  limit?: number;
  sort_by?:
    | "name"
    | "domain"
    | "totalCalls"
    | "lastCallDate"
    | "storyCount"
    | "landingPageCount"
    | "createdAt";
  sort_order?: "asc" | "desc";
}): Promise<AccountsListResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.funnel_stage) qs.set("funnel_stage", params.funnel_stage);
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.sort_by) qs.set("sort_by", params.sort_by);
  if (params?.sort_order) qs.set("sort_order", params.sort_order);
  const query = qs.toString();
  return request<AccountsListResponse>(`/accounts${query ? `?${query}` : ""}`);
}

export async function searchAccounts(query: string): Promise<{ accounts: AccountSearchResult[] }> {
  return request<{ accounts: AccountSearchResult[] }>(`/dashboard/accounts/search?q=${encodeURIComponent(query)}`);
}

export async function getChatAccounts(search?: string): Promise<{ accounts: ChatAccount[] }> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<{ accounts: ChatAccount[] }>(`/rag/accounts${qs}`);
}

export async function sendChatMessage(body: {
  query: string;
  account_id: string | null;
  history: Array<{ role: string; content: string }>;
  top_k?: number;
}): Promise<{ answer: string; sources: ChatSource[] }> {
  return request<{ answer: string; sources: ChatSource[] }>("/rag/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getAccountJourney(accountId: string): Promise<{
  account: JourneyAccount;
  timeline: JourneyTimelineNode[];
  stage_counts: Record<string, number>;
}> {
  return request<{
    account: JourneyAccount;
    timeline: JourneyTimelineNode[];
    stage_counts: Record<string, number>;
  }>(`/accounts/${accountId}/journey`);
}
