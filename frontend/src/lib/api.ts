/**
 * API client for StoryEngine backend.
 */

import type { FunnelStage, TaxonomyTopic, StoryFormat } from "../types/taxonomy";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BuildStoryRequest {
  account_id: string;
  funnel_stages?: FunnelStage[];
  filter_topics?: TaxonomyTopic[];
  title?: string;
  format?: StoryFormat;
}

export interface StoryQuote {
  speaker: string | null;
  quote_text: string;
  context: string | null;
  metric_type: string | null;
  metric_value: string | null;
  call_id?: string;
}

export interface BuildStoryResponse {
  title: string;
  markdown: string;
  quotes: StoryQuote[];
}

export interface StorySummary {
  id: string;
  title: string;
  story_type: string;
  funnel_stages: FunnelStage[];
  filter_tags: string[];
  generated_at: string;
  markdown: string;
  quotes: StoryQuote[];
}

export interface CreateLandingPageRequest {
  story_id: string;
  title: string;
  subtitle?: string;
  callout_boxes?: Array<{
    title: string;
    body: string;
    icon?: string;
  }>;
}

export interface CreateLandingPageResponse {
  id: string;
  slug: string;
  title: string;
  status: string;
  editable_body: string;
  callout_boxes: unknown[];
  total_call_hours: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const BASE_URL = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function buildStory(
  req: BuildStoryRequest
): Promise<BuildStoryResponse> {
  return request<BuildStoryResponse>("/stories/build", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getAccountStories(
  accountId: string
): Promise<{ stories: StorySummary[] }> {
  return request<{ stories: StorySummary[] }>(`/stories/${accountId}`);
}

export async function createLandingPage(
  req: CreateLandingPageRequest
): Promise<CreateLandingPageResponse> {
  return request<CreateLandingPageResponse>("/pages", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
