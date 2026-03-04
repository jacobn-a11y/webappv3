import { request } from "./http";
import type {
  QuoteAttributionDisplay,
  QuoteLibraryResponse,
  QuoteSourceSegmentResponse,
} from "./types";

export interface QuoteLibraryQuery {
  q?: string;
  tier?: "AUTO" | "CURATED" | "ALL";
  account_id?: string;
  date_from?: string;
  date_to?: string;
  starred?: boolean;
  limit?: number;
  offset?: number;
}

export async function getQuoteLibrary(
  query: QuoteLibraryQuery = {}
): Promise<QuoteLibraryResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tier) params.set("tier", query.tier);
  if (query.account_id) params.set("account_id", query.account_id);
  if (query.date_from) params.set("date_from", query.date_from);
  if (query.date_to) params.set("date_to", query.date_to);
  if (typeof query.starred === "boolean") {
    params.set("starred", query.starred ? "true" : "false");
  }
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (typeof query.offset === "number") params.set("offset", String(query.offset));

  const suffix = params.toString().length > 0 ? `?${params.toString()}` : "";
  return request<QuoteLibraryResponse>(`/quotes${suffix}`);
}

export async function getQuoteAttributionSettings(): Promise<{
  display: QuoteAttributionDisplay;
}> {
  return request<{ display: QuoteAttributionDisplay }>(
    "/quotes/settings/attribution"
  );
}

export async function saveQuoteAttributionSettings(display: QuoteAttributionDisplay): Promise<{
  saved: boolean;
  display: QuoteAttributionDisplay;
}> {
  return request<{ saved: boolean; display: QuoteAttributionDisplay }>(
    "/quotes/settings/attribution",
    {
      method: "PUT",
      body: JSON.stringify({ display }),
    }
  );
}

export async function saveQuoteFromTranscript(input: {
  call_id: string;
  source_chunk_id: string;
  quote_text?: string;
  curation_note?: string;
}): Promise<{ id: string; tier: "AUTO" | "CURATED" }> {
  return request<{ id: string; tier: "AUTO" | "CURATED" }>(
    "/quotes/from-transcript",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function promoteQuote(
  quoteId: string,
  curationNote?: string
): Promise<{ id: string; tier: "AUTO" | "CURATED" }> {
  return request<{ id: string; tier: "AUTO" | "CURATED" }>(
    `/quotes/${encodeURIComponent(quoteId)}/promote`,
    {
      method: "POST",
      body: JSON.stringify(curationNote ? { curation_note: curationNote } : {}),
    }
  );
}

export async function demoteQuote(
  quoteId: string
): Promise<{ id: string; tier: "AUTO" | "CURATED" }> {
  return request<{ id: string; tier: "AUTO" | "CURATED" }>(
    `/quotes/${encodeURIComponent(quoteId)}/demote`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
}

export async function starQuote(quoteId: string): Promise<{ starred: boolean }> {
  return request<{ starred: boolean }>(`/quotes/${encodeURIComponent(quoteId)}/star`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function unstarQuote(
  quoteId: string
): Promise<{ starred: boolean }> {
  return request<{ starred: boolean }>(`/quotes/${encodeURIComponent(quoteId)}/star`, {
    method: "DELETE",
  });
}

export async function getQuoteSourceSegment(
  quoteId: string
): Promise<QuoteSourceSegmentResponse> {
  return request<QuoteSourceSegmentResponse>(
    `/quotes/${encodeURIComponent(quoteId)}/source-segment`
  );
}
