import type {
  BuildStoryRequest,
  BuildStoryResponse,
  StoryComment,
  StoryLibraryItem,
  StorySummary,
} from "../api";
import { BASE_URL, buildRequestHeaders, request } from "./http";

export async function buildStory(
  req: BuildStoryRequest,
  options?: {
    signal?: AbortSignal;
  }
): Promise<BuildStoryResponse> {
  return request<BuildStoryResponse>("/stories/build", {
    method: "POST",
    body: JSON.stringify(req),
    signal: options?.signal,
  });
}

export async function buildStoryStream(
  req: BuildStoryRequest,
  handlers: {
    onProgress?: (step: string) => void;
    onToken?: (token: string) => void;
    onComplete?: (payload: BuildStoryResponse) => void;
  },
  options?: {
    signal?: AbortSignal;
  }
): Promise<BuildStoryResponse> {
  const headers = buildRequestHeaders();
  const response = await fetch(`${BASE_URL}/stories/build/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
    signal: options?.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Streaming not supported by this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let finalPayload: BuildStoryResponse | null = null;

  const flushBlock = (block: string) => {
    const lines = block.split("\n");
    let event = currentEvent;
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trim();
      }
    }

    if (!data) return;
    const parsed = JSON.parse(data) as Record<string, unknown>;

    if (event === "progress" && typeof parsed.step === "string") {
      handlers.onProgress?.(parsed.step);
      return;
    }

    if (event === "token" && typeof parsed.token === "string") {
      handlers.onToken?.(parsed.token);
      return;
    }

    if (event === "complete") {
      const payload = parsed as unknown as BuildStoryResponse;
      finalPayload = payload;
      handlers.onComplete?.(payload);
      return;
    }

    if (event === "error") {
      throw new Error(
        typeof parsed.error === "string" ? parsed.error : "Streaming request failed"
      );
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      if (block.trim().length === 0) continue;
      flushBlock(block);
    }
  }

  if (buffer.trim().length > 0) {
    flushBlock(buffer);
  }

  if (!finalPayload) {
    throw new Error("Story stream ended without a final payload.");
  }

  return finalPayload;
}

export async function getAccountStories(
  accountId: string
): Promise<{ stories: StorySummary[] }> {
  return request<{ stories: StorySummary[] }>(`/stories/${accountId}`);
}

export async function getStoryLibrary(params?: {
  search?: string;
  story_type?: string;
  status?: "DRAFT" | "PAGE_CREATED" | "PUBLISHED" | "ARCHIVED";
  page?: number;
  limit?: number;
}): Promise<{
  stories: StoryLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.story_type) qs.set("story_type", params.story_type);
  if (params?.status) qs.set("status", params.status);
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return request<{
    stories: StoryLibraryItem[];
    pagination: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
    };
  }>(`/stories/library${query ? `?${query}` : ""}`);
}

export async function deleteStory(storyId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/stories/${storyId}`, {
    method: "DELETE",
  });
}

export async function downloadStoryExport(
  storyId: string,
  format: "pdf" | "docx"
): Promise<Blob> {
  const headers = buildRequestHeaders();
  const response = await fetch(
    `${BASE_URL}/stories/${encodeURIComponent(storyId)}/export?format=${format}`,
    {
      method: "GET",
      headers,
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.blob();
}

export async function getStoryComments(
  storyId: string,
  options?: { target?: "story" | "page"; page_id?: string }
): Promise<{ comments: StoryComment[] }> {
  const qs = new URLSearchParams();
  if (options?.target) qs.set("target", options.target);
  if (options?.page_id) qs.set("page_id", options.page_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ comments: StoryComment[] }>(
    `/stories/${encodeURIComponent(storyId)}/comments${suffix}`
  );
}

export async function createStoryComment(
  storyId: string,
  body: {
    message: string;
    parent_id?: string;
    target?: "story" | "page";
    page_id?: string;
  }
): Promise<StoryComment> {
  return request<StoryComment>(`/stories/${encodeURIComponent(storyId)}/comments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
