import type {
  FunnelStage,
  TaxonomyTopic,
  StoryFormat,
  StoryLength,
  StoryOutline,
  StoryTypeInput,
} from "../../../types/taxonomy";

export interface BuildStoryRequest {
  account_id: string;
  funnel_stages?: FunnelStage[];
  filter_topics?: TaxonomyTopic[];
  title?: string;
  format?: StoryFormat;
  story_length?: StoryLength;
  story_outline?: StoryOutline;
  story_type?: StoryTypeInput;
  ai_provider?: "openai" | "anthropic" | "google";
  ai_model?: string;
}

export interface StoryQuote {
  speaker: string | null;
  quote_text: string;
  context: string | null;
  metric_type: string | null;
  metric_value: string | null;
  confidence_score?: number;
  call_id?: string;
  source_chunk_id?: string;
  source_timestamp_ms?: number;
  source_call_title?: string;
  source_recording_url?: string;
  transcript_deep_link?: string;
}

export interface BuildStoryResponse {
  story_id: string | null;
  title: string;
  markdown: string;
  quotes: StoryQuote[];
}

export interface StoryLandingPageSummary {
  id: string;
  slug?: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  published_at: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  sessionToken: string;
  sessionExpiresAt: string;
}

export interface InviteSummary {
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  organizationId: string;
  organizationName: string;
  expiresAt: string;
}

export interface StorySummary {
  id: string;
  title: string;
  story_type: string;
  story_status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  funnel_stages: FunnelStage[];
  filter_tags: string[];
  generated_at: string;
  markdown: string;
  landing_page: StoryLandingPageSummary | null;
  quotes: StoryQuote[];
}

export interface StoryLibraryItem extends StorySummary {
  account: {
    id: string;
    name: string;
    domain: string | null;
  };
}

export interface StoryLibraryTaxonomyCounts {
  funnel_stage_counts: Record<string, number>;
  topic_counts: Record<string, number>;
}

export interface StoryComment {
  id: string;
  message: string;
  parent_id: string | null;
  target_type: "STORY" | "PAGE";
  target_id: string;
  created_at: string;
  author: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export interface AccountsListItem {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  totalCalls: number;
  lastCallDate: string | null;
  storyCount: number;
  landingPageCount: number;
  createdAt: string;
  funnelStageDistribution: Array<{
    stage: string;
    count: number;
  }>;
}

export interface AccountsListResponse {
  accounts: AccountsListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface CreateLandingPageRequest {
  story_id: string;
  title: string;
  subtitle?: string;
  include_company_name?: boolean;
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
