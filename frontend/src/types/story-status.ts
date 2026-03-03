/**
 * Shared story status display constants.
 *
 * Centralizes status labels, hints, and badge classes so they stay in sync
 * across StoryLibraryPage, AccountDetailPage, and any future story lists.
 */

export type StoryStatus = "DRAFT" | "PAGE_CREATED" | "PUBLISHED" | "ARCHIVED";

export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  DRAFT: "Draft",
  PAGE_CREATED: "Page Created",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const STORY_STATUS_HINTS: Record<StoryStatus, string> = {
  DRAFT: "Story is generated but not yet packaged into a page.",
  PAGE_CREATED: "Landing page exists and can be finalized for share.",
  PUBLISHED: "Published and share-ready.",
  ARCHIVED: "Archived and hidden from active workflows.",
};

export const STORY_STATUS_BADGES: Record<StoryStatus, string> = {
  DRAFT: "badge--draft",
  PAGE_CREATED: "badge--accent",
  PUBLISHED: "badge--success",
  ARCHIVED: "badge--archived",
};
