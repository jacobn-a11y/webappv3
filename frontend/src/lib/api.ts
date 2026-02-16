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

// ─── Admin Account Access ───────────────────────────────────────────────────

export interface AccessUser {
  user_id: string;
  user_name: string | null;
  user_email: string;
  role: string;
  grants: AccessGrant[];
}

export interface AccessGrant {
  id: string;
  scope_type: string;
  account?: { id: string; name: string; domain: string | null };
  cached_account_count: number;
  crm_report_id?: string;
  crm_provider?: string;
  crm_report_name?: string;
  last_synced_at?: string;
}

export interface AccountSearchResult {
  id: string;
  name: string;
  domain: string | null;
}

export interface CrmReport {
  id: string;
  name: string;
}

// ─── Admin Permissions ──────────────────────────────────────────────────────

export interface PermissionUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: string;
  permissions: string[];
  accessGrants?: PermissionAccessGrant[];
}

export interface PermissionAccessGrant {
  id: string;
  scopeType: string;
  account: { id: string; name: string; domain: string | null } | null;
  cachedAccountIds: string[];
  crmReportId: string | null;
  crmProvider: string | null;
  crmReportName: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

// ─── Transcript Viewer ──────────────────────────────────────────────────────

export interface TranscriptSegmentTag {
  funnelStage: string;
  topic: string;
  confidence: number;
}

export interface TranscriptSegment {
  id: string;
  chunkIndex: number;
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  tags: TranscriptSegmentTag[];
}

export interface TranscriptParticipant {
  name: string | null;
  email: string | null;
  isHost: boolean;
  contactName: string | null;
  contactTitle: string | null;
}

export interface TranscriptEntityInfo {
  accountId: string | null;
  accountName: string | null;
  accountDomain: string | null;
  accountIndustry: string | null;
}

export interface TranscriptCallMeta {
  id: string;
  title: string | null;
  provider: string;
  duration: number | null;
  occurredAt: string;
  recordingUrl: string | null;
  language: string;
  wordCount: number;
}

export interface TranscriptData {
  meta: TranscriptCallMeta;
  segments: TranscriptSegment[];
  participants: TranscriptParticipant[];
  entity: TranscriptEntityInfo;
  callTags: TranscriptSegmentTag[];
}

// ─── Editor Page ────────────────────────────────────────────────────────────

export interface EditorPageData {
  pageId: string;
  title: string;
  subtitle: string;
  editableBody: string;
  status: string;
  visibility: string;
  includeCompanyName: boolean;
  canPublishNamed: boolean;
}

// ─── Dashboard Pages ────────────────────────────────────────────────────────

export interface DashboardStats {
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  totalViews: number;
}

export interface DashboardPageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  viewCount: number;
  accountName: string;
  createdByName: string;
  createdByEmail: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface DashboardCreator {
  userId: string;
  name: string | null;
  email: string;
}

// ─── Chatbot Connector ──────────────────────────────────────────────────────

export interface ChatAccount {
  id: string;
  name: string;
  domain: string | null;
  call_count: number;
}

export interface ChatSource {
  call_id: string;
  call_title: string;
  call_date: string;
  speaker: string;
  text: string;
  relevance_score: number;
}

// ─── Analytics Dashboard ────────────────────────────────────────────────────

export interface AnalyticsData {
  summary: {
    totalCalls: number;
    totalAccounts: number;
    totalTranscriptHours: number;
    overallResolutionRate: number;
    totalQuotes: number;
    totalPageViews: number;
  };
  callsPerWeek: Array<{ weekStart: string; count: number }>;
  funnelDistribution: Array<{ stage: string; count: number }>;
  topAccounts: Array<{ accountName: string; callCount: number }>;
  entityResolutionOverTime: Array<{ weekStart: string; rate: number; resolvedCalls: number; totalCalls: number }>;
  topTopics: Array<{ label: string; count: number; funnelStage: string }>;
  quoteLeaderboard: Array<{ accountName: string; quoteCount: number }>;
  topPagesByViews: Array<{ title: string; slug: string; viewCount: number; publishedAt: string | null }>;
  viewsOverTime: Array<{ weekStart: string; totalViews: number; pagesPublished: number }>;
}

// ─── Account Journey ────────────────────────────────────────────────────────

export interface JourneyAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  salesforce_id: string | null;
  hubspot_id: string | null;
  contact_count: number;
  call_count: number;
  total_call_minutes: number;
  story_count: number;
  top_contacts: Array<{
    id: string;
    name: string | null;
    email: string | null;
    title: string | null;
    call_appearances: number;
  }>;
}

export interface JourneyTimelineNode {
  type: "call" | "crm_event";
  id: string;
  date: string;
  // Call-specific
  title?: string;
  provider?: string;
  duration?: number;
  primary_stage?: string;
  participants?: Array<{
    id: string;
    name: string | null;
    email: string | null;
    is_host: boolean;
    title: string | null;
  }>;
  tags?: Array<{
    funnel_stage: string;
    topic: string;
    topic_label: string;
    confidence: number;
  }>;
  // CRM event-specific
  event_type?: string;
  stage_name?: string;
  opportunity_id?: string;
  amount?: number;
  description?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const BASE_URL = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
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

// ─── Admin Account Access ───────────────────────────────────────────────────

export async function getAccessUsers(): Promise<{ users: AccessUser[] }> {
  return request<{ users: AccessUser[] }>("/dashboard/access");
}

export async function searchAccounts(query: string): Promise<{ accounts: AccountSearchResult[] }> {
  return request<{ accounts: AccountSearchResult[] }>(`/dashboard/accounts/search?q=${encodeURIComponent(query)}`);
}

export async function grantAccess(body: {
  user_id: string;
  scope_type: string;
  account_id?: string;
  account_ids?: string[];
  crm_report_id?: string;
  crm_provider?: string;
  crm_report_name?: string;
}): Promise<void> {
  return request<void>("/dashboard/access/grant", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function revokeAccess(grantId: string): Promise<void> {
  return request<void>(`/dashboard/access/${grantId}`, { method: "DELETE" });
}

export async function syncAccessGrant(grantId: string): Promise<{ account_count: number }> {
  return request<{ account_count: number }>(`/dashboard/access/${grantId}/sync`, { method: "POST" });
}

export async function getCrmReports(provider: string): Promise<{ reports: CrmReport[] }> {
  return request<{ reports: CrmReport[] }>(`/dashboard/crm-reports?provider=${encodeURIComponent(provider)}`);
}

// ─── Admin Permissions ──────────────────────────────────────────────────────

export async function getPermissions(): Promise<{ users: PermissionUser[] }> {
  return request<{ users: PermissionUser[] }>("/dashboard/permissions");
}

export async function grantPermission(userId: string, permission: string): Promise<void> {
  return request<void>("/dashboard/permissions/grant", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, permission }),
  });
}

export async function revokePermission(userId: string, permission: string): Promise<void> {
  return request<void>("/dashboard/permissions/revoke", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, permission }),
  });
}

// ─── Transcript Viewer ──────────────────────────────────────────────────────

export async function getTranscriptData(callId: string): Promise<TranscriptData> {
  return request<TranscriptData>(`/calls/${callId}/transcript`);
}

// ─── Editor Page ────────────────────────────────────────────────────────────

export async function getEditorPageData(pageId: string): Promise<EditorPageData> {
  return request<EditorPageData>(`/pages/${pageId}/edit-data`);
}

export async function savePageDraft(pageId: string, body: string): Promise<void> {
  return request<void>(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ editable_body: body }),
  });
}

export async function getPreviewScrub(pageId: string): Promise<{
  original: { body: string };
  scrubbed: { body: string };
  replacements_made: number;
}> {
  return request<{ original: { body: string }; scrubbed: { body: string }; replacements_made: number }>(
    `/pages/${pageId}/preview-scrub`,
    { method: "POST" }
  );
}

export async function publishPage(pageId: string, options: {
  visibility: string;
  password?: string;
  expires_at?: string;
}): Promise<{ url: string }> {
  return request<{ url: string }>(`/pages/${pageId}/publish`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

// ─── Dashboard Pages ────────────────────────────────────────────────────────

export async function getDashboardPagesData(params?: {
  search?: string;
  status?: string;
  visibility?: string;
  created_by?: string;
  sort_by?: string;
  sort_dir?: string;
}): Promise<{
  stats: DashboardStats;
  pages: DashboardPageSummary[];
  creators: DashboardCreator[];
  isAdmin: boolean;
}> {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  }
  const query = qs.toString();
  return request<{
    stats: DashboardStats;
    pages: DashboardPageSummary[];
    creators: DashboardCreator[];
    isAdmin: boolean;
  }>(`/dashboard/pages/data${query ? `?${query}` : ""}`);
}

export async function unpublishPage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}/unpublish`, { method: "POST" });
}

export async function archivePage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}/archive`, { method: "POST" });
}

export async function deletePage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}`, { method: "DELETE" });
}

// ─── Chatbot Connector ──────────────────────────────────────────────────────

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

// ─── Analytics Dashboard ────────────────────────────────────────────────────

export async function getAnalyticsData(): Promise<AnalyticsData> {
  return request<AnalyticsData>("/analytics");
}

// ─── Account Journey ────────────────────────────────────────────────────────

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
