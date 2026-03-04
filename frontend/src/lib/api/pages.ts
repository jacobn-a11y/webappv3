import type {
  ArtifactVersion,
  CreateLandingPageRequest,
  CreateLandingPageResponse,
  DashboardCreator,
  DashboardPageSummary,
  DashboardStats,
  EditorPageData,
  PublishApprovalRequestRow,
  SavePageDraftConflict,
  SavePageDraftResult,
  TranscriptData,
} from "./types";
import { BASE_URL, buildRequestHeaders, fetchApi, request } from "./http";

export async function createLandingPage(
  req: CreateLandingPageRequest
): Promise<CreateLandingPageResponse> {
  return request<CreateLandingPageResponse>("/pages", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getEditorPageData(pageId: string): Promise<EditorPageData> {
  return request<EditorPageData>(`/pages/${pageId}/edit-data`);
}

export async function savePageDraft(
  pageId: string,
  body: string,
  options?: { expectedUpdatedAt?: string; allowConflict?: boolean }
): Promise<SavePageDraftResult> {
  const payload: Record<string, unknown> = { editable_body: body };
  if (options?.expectedUpdatedAt) {
    payload.expected_updated_at = options.expectedUpdatedAt;
  }

  const response = await fetchApi(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  const parsed = await response.json().catch(() => ({ error: response.statusText }));
  if (response.status === 409 && parsed.error === "concurrency_conflict") {
    const conflict: SavePageDraftConflict = {
      conflict: true,
      expected_updated_at:
        typeof parsed.expected_updated_at === "string"
          ? parsed.expected_updated_at
          : options?.expectedUpdatedAt ?? "",
      current_updated_at:
        typeof parsed.current_updated_at === "string"
          ? parsed.current_updated_at
          : "",
      latest_editable_body:
        typeof parsed.latest_editable_body === "string"
          ? parsed.latest_editable_body
          : "",
      message:
        typeof parsed.message === "string"
          ? parsed.message
          : "This page has newer changes from another editor.",
    };
    if (options?.allowConflict) {
      return conflict;
    }
    throw new Error(conflict.message);
  }

  if (!response.ok) {
    throw new Error(parsed.error ?? `Request failed: ${response.status}`);
  }

  return {
    conflict: false,
    updated_at:
      typeof parsed.updated_at === "string"
        ? parsed.updated_at
        : new Date().toISOString(),
  };
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
  release_notes?: string;
}): Promise<{ url?: string; queued_for_approval?: boolean; request_id?: string }> {
  return request<{ url?: string; queued_for_approval?: boolean; request_id?: string }>(`/pages/${pageId}/publish`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function getScheduledPagePublish(pageId: string): Promise<{
  enabled: boolean;
  scheduled: boolean;
  state?: string;
  publish_at?: string;
  visibility?: string;
  expires_at?: string | null;
}> {
  return request<{
    enabled: boolean;
    scheduled: boolean;
    state?: string;
    publish_at?: string;
    visibility?: string;
    expires_at?: string | null;
  }>(`/pages/${pageId}/scheduled-publish`);
}

export async function schedulePagePublish(
  pageId: string,
  options: {
    publish_at: string;
    visibility: string;
    password?: string;
    expires_at?: string;
    release_notes?: string;
  }
): Promise<{ scheduled: boolean; publish_at: string }> {
  return request<{ scheduled: boolean; publish_at: string }>(
    `/pages/${pageId}/schedule-publish`,
    {
      method: "POST",
      body: JSON.stringify(options),
    }
  );
}

export async function cancelScheduledPagePublish(pageId: string): Promise<void> {
  await request<void>(`/pages/${pageId}/scheduled-publish`, {
    method: "DELETE",
  });
}

export async function getPageVersions(pageId: string): Promise<{ versions: ArtifactVersion[] }> {
  return request<{ versions: ArtifactVersion[] }>(`/pages/${pageId}/versions`);
}

export async function rollbackPageVersion(pageId: string, versionId: string): Promise<{ rolled_back: boolean }> {
  return request<{ rolled_back: boolean }>(`/pages/${pageId}/versions/${versionId}/rollback`, {
    method: "POST",
  });
}

export async function getPublishApprovals(status = "PENDING"): Promise<{ approvals: PublishApprovalRequestRow[] }> {
  return request<{ approvals: PublishApprovalRequestRow[] }>(`/pages/approvals/publish?status=${encodeURIComponent(status)}`);
}

export async function reviewPublishApproval(
  requestId: string,
  body: { decision: "APPROVE" | "REJECT"; notes?: string }
): Promise<{ status: string; published?: boolean; url?: string }> {
  return request<{ status: string; published?: boolean; url?: string }>(`/pages/approvals/publish/${requestId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
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

export async function getTranscriptData(callId: string): Promise<TranscriptData> {
  return request<TranscriptData>(`/calls/${callId}/transcript`);
}
