import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../../components/Toast";
import {
  createStoryComment,
  createLandingPage,
  deleteStory,
  downloadStoryExport,
  getStoryComments,
  getStoryLibrary,
  getStoryLibraryTaxonomy,
  requestWriteback,
  trackSellerAdoptionEvent,
  type StoryComment,
  type StoryLibraryItem,
} from "../../lib/api";
import {
  FUNNEL_STAGE_LABELS,
  STAGE_TOPICS,
  STORY_TYPE_LABELS,
  type FunnelStage,
} from "../../types/taxonomy";

// ─── Constants ────────────────────────────────────────────────────────────────

export const STORY_STATUS_LABELS: Record<StoryLibraryItem["story_status"], string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
};

export const STORY_STATUS_HINTS: Record<StoryLibraryItem["story_status"], string> = {
  DRAFT: "Story is in draft and not yet in the publish flow.",
  IN_REVIEW: "Publish request is pending approval.",
  APPROVED: "Approved and ready for publish.",
  PUBLISHED: "Published and share-ready.",
};

export const STORY_STATUS_BADGES: Record<StoryLibraryItem["story_status"], string> = {
  DRAFT: "badge--draft",
  IN_REVIEW: "badge--warning",
  APPROVED: "badge--success",
  PUBLISHED: "badge--success",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function getStoryPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[>#*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

export function getStoryConfidence(story: StoryLibraryItem): number | null {
  const scores = story.quotes
    .map((quote) => quote.confidence_score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function buildCrmNote(story: StoryLibraryItem): string {
  const funnel = story.funnel_stages.length > 0 ? story.funnel_stages.join(", ") : "N/A";
  const topQuote = story.quotes[0]?.quote_text ?? "No quote captured";
  const topMetric = story.quotes.find((quote) => quote.metric_value)?.metric_value ?? "N/A";
  return [
    `Story: ${story.title}`,
    `Account: ${story.account.name}`,
    `Funnel Stage(s): ${funnel}`,
    `Top Metric: ${topMetric}`,
    `Proof Quote: "${topQuote}"`,
    "",
    "Summary:",
    story.markdown.slice(0, 1200),
  ].join("\n");
}

function trackStoryLibraryAction(
  story: StoryLibraryItem,
  eventType: "share_action" | "library_action",
  actionName: string,
  metadata?: Record<string, unknown>
): void {
  void trackSellerAdoptionEvent({
    event_type: eventType,
    flow_id: `library-${story.id}-${Date.now()}`,
    account_id: story.account.id,
    story_id: story.id,
    action_name: actionName,
    stage_preset: story.funnel_stages[0] ?? "unknown",
    metadata,
  }).catch(() => {
    // Best-effort telemetry only.
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ConfirmState {
  action: () => void;
  title: string;
  message: string;
}

function confirmGovernedExport(message?: string): boolean {
  return window.confirm(
    message ??
      "This export may contain PII or named customer data. Confirm you have permission to share externally."
  );
}

export function useStoryLibrary(userRole: string) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryLibraryItem[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [status, setStatus] = useState<"ALL" | StoryLibraryItem["story_status"]>("ALL");
  const [storyType, setStoryType] = useState("ALL");
  const [funnelStage, setFunnelStage] = useState<string>(
    searchParams.get("funnel_stage")?.trim() || "ALL"
  );
  const [topic, setTopic] = useState<string>(
    searchParams.get("topic")?.trim() || "ALL"
  );
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [serverLimit, setServerLimit] = useState(20);
  const [busyStoryId, setBusyStoryId] = useState<string | null>(null);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [commentStory, setCommentStory] = useState<StoryLibraryItem | null>(null);
  const [commentTarget, setCommentTarget] = useState<"story" | "page">("story");
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [funnelStageCounts, setFunnelStageCounts] = useState<Record<string, number>>({});
  const [topicCounts, setTopicCounts] = useState<Record<string, number>>({});

  const isViewer = userRole === "VIEWER";

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (funnelStage !== "ALL") next.set("funnel_stage", funnelStage);
      else next.delete("funnel_stage");
      if (topic !== "ALL") next.set("topic", topic);
      else next.delete("topic");
      return next;
    }, { replace: true });
  }, [funnelStage, topic, setSearchParams]);

  useEffect(() => {
    void getStoryLibraryTaxonomy()
      .then((res) => {
        setFunnelStageCounts(res.funnel_stage_counts ?? {});
        setTopicCounts(res.topic_counts ?? {});
      })
      .catch(() => {
        setFunnelStageCounts({});
        setTopicCounts({});
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const runLoad = async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await getStoryLibrary({
          page,
          limit: pageSize,
          search: search || undefined,
          search_mode: searchMode,
          story_type: storyType === "ALL" ? undefined : storyType,
          status: status === "ALL" ? undefined : status,
          funnel_stage:
            funnelStage === "ALL" ? undefined : [funnelStage],
          topic: topic === "ALL" ? undefined : [topic],
        });
        if (cancelled) return;
        setStories(res.stories);
        setServerLimit(res.pagination.limit);
        setTotalPages(Math.max(res.pagination.totalPages, 1));
        setTotalCount(res.pagination.totalCount);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load story library");
        setStories([]);
      } finally {
        if (!cancelled && !opts?.silent) {
          setLoading(false);
        }
      }
    };

    void runLoad();
    const intervalId = window.setInterval(() => {
      void runLoad({ silent: true });
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [page, pageSize, search, searchMode, status, storyType, funnelStage, topic]);

  const uniqueStoryTypes = useMemo(() => Object.keys(STORY_TYPE_LABELS).sort(), []);
  const availableFunnelStages = useMemo(
    () => Object.keys(FUNNEL_STAGE_LABELS).sort() as FunnelStage[],
    []
  );
  const availableTopics = useMemo(() => {
    const topics =
      funnelStage === "ALL"
        ? (Object.values(STAGE_TOPICS).flat() as string[])
        : [...(STAGE_TOPICS[funnelStage as FunnelStage] ?? [])];
    return Array.from(new Set(topics)).sort();
  }, [funnelStage]);
  const selectedStories = useMemo(() => {
    const selectedSet = new Set(selectedStoryIds);
    return stories.filter((story) => selectedSet.has(story.id));
  }, [selectedStoryIds, stories]);
  const allSelectedOnPage = stories.length > 0 && selectedStoryIds.length === stories.length;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * serverLimit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(rangeStart + serverLimit - 1, totalCount);

  useEffect(() => { setSelectedStoryIds([]); }, [page, search, searchMode, storyType, status, funnelStage, topic]);

  useEffect(() => {
    if (!commentStory) {
      setComments([]);
      setCommentsError(null);
      return;
    }
    let cancelled = false;
    setCommentsLoading(true);
    setCommentsError(null);
    void getStoryComments(commentStory.id, {
      target: commentTarget,
      page_id: commentTarget === "page" ? commentStory.landing_page?.id : undefined,
    })
      .then((res) => { if (!cancelled) setComments(res.comments); })
      .catch((err) => { if (!cancelled) setCommentsError(err instanceof Error ? err.message : "Failed to load comments"); })
      .finally(() => { if (!cancelled) setCommentsLoading(false); });
    return () => { cancelled = true; };
  }, [commentStory, commentTarget]);

  const handleExport = useCallback(async (story: StoryLibraryItem, format: "pdf" | "docx") => {
    if (!confirmGovernedExport()) {
      return;
    }
    setBusyStoryId(story.id);
    try {
      const blob = await downloadStoryExport(story.id, format);
      const safeTitle = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      saveBlob(blob, `${safeTitle || "story"}.${format}`);
      trackStoryLibraryAction(story, "share_action", `export_${format}`);
    } finally {
      setBusyStoryId(null);
    }
  }, []);

  const handleCreateOrEditPage = useCallback(async (story: StoryLibraryItem) => {
    setBusyStoryId(story.id);
    try {
      if (story.landing_page?.id) {
        trackStoryLibraryAction(story, "library_action", "open_page_editor", { page_id: story.landing_page.id });
        navigate(`/pages/${story.landing_page.id}/edit`);
        return;
      }
      const lp = await createLandingPage({ story_id: story.id, title: story.title });
      trackStoryLibraryAction(story, "share_action", "create_page", { page_id: lp.id, page_slug: lp.slug });
      navigate(`/pages/${lp.id}/edit`);
    } finally {
      setBusyStoryId(null);
    }
  }, [navigate]);

  const handleShare = useCallback(async (story: StoryLibraryItem) => {
    if (story.landing_page?.slug) {
      const shareUrl = `${window.location.origin}/s/${story.landing_page.slug}`;
      try { await navigator.clipboard.writeText(shareUrl); } catch {
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      showToast(`Share link copied for "${story.title}".`, "success");
      trackStoryLibraryAction(story, "share_action", "copy_share_link", { url: shareUrl });
      return;
    }
    showToast(story.landing_page ? "Page exists but is not published yet. Open the editor to publish first." : "Create a landing page first, then publish to get a share link.");
    trackStoryLibraryAction(story, "library_action", "share_blocked", { has_page: !!story.landing_page, page_status: story.landing_page?.status ?? null });
  }, [showToast]);

  const handleDelete = useCallback((story: StoryLibraryItem) => {
    setConfirmState({
      title: "Delete Story",
      message: `Are you sure you want to delete the story "${story.title}"? This action cannot be undone.`,
      action: async () => {
        setBusyStoryId(story.id);
        try {
          await deleteStory(story.id);
          setStories((prev) => prev.filter((s) => s.id !== story.id));
          setTotalCount((prev) => Math.max(0, prev - 1));
          trackStoryLibraryAction(story, "library_action", "delete_story");
        } finally {
          setBusyStoryId(null);
        }
      },
    });
  }, []);

  const handleCopyStoryMarkdown = useCallback(async (story: StoryLibraryItem) => {
    await navigator.clipboard.writeText(story.markdown);
    showToast(`Copied story markdown for "${story.title}".`, "success");
    trackStoryLibraryAction(story, "share_action", "copy_story_markdown");
  }, [showToast]);

  const handleCopyCrmNote = useCallback(async (story: StoryLibraryItem) => {
    const note = buildCrmNote(story);
    await navigator.clipboard.writeText(note);
    showToast(`Copied CRM note for "${story.title}".`, "success");
    trackStoryLibraryAction(story, "share_action", "copy_crm_note");
  }, [showToast]);

  const handlePushCrmNote = useCallback((story: StoryLibraryItem) => {
    setConfirmState({
      title: "Push CRM Note",
      message: `Are you sure you want to push a CRM note for "${story.title}" to account "${story.account.name}"? This will create a new note in your CRM.`,
      action: async () => {
        setBusyStoryId(story.id);
        try {
          await requestWriteback({ action_type: "NOTE", account_id: story.account.id, title: `StoryEngine: ${story.title}`, body: buildCrmNote(story), metadata: { source: "story_library", story_id: story.id } });
          showToast(`Queued CRM note writeback for "${story.title}".`, "success");
          trackStoryLibraryAction(story, "share_action", "push_crm_note");
        } catch (err) {
          showToast(err instanceof Error ? `CRM writeback failed: ${err.message}` : "CRM writeback failed.", "error");
        } finally {
          setBusyStoryId(null);
        }
      },
    });
  }, [showToast]);

  const toggleStorySelection = useCallback((storyId: string) => {
    setSelectedStoryIds((prev) => prev.includes(storyId) ? prev.filter((id) => id !== storyId) : [...prev, storyId]);
  }, []);

  const toggleSelectAllOnPage = useCallback(() => {
    if (allSelectedOnPage) { setSelectedStoryIds([]); return; }
    setSelectedStoryIds(stories.map((story) => story.id));
  }, [allSelectedOnPage, stories]);

  const handleBulkCopy = useCallback(async () => {
    if (selectedStories.length === 0) return;
    const payload = selectedStories.map((story) => `# ${story.title}\n\nAccount: ${story.account.name}\nStatus: ${STORY_STATUS_LABELS[story.story_status]}\n\n${story.markdown}`).join("\n\n---\n\n");
    await navigator.clipboard.writeText(payload);
    showToast(`Copied ${selectedStories.length} stor${selectedStories.length === 1 ? "y" : "ies"} to clipboard.`, "success");
  }, [selectedStories, showToast]);

  const doBulkExport = useCallback(async (format: "pdf" | "docx") => {
    if (
      !confirmGovernedExport(
        `You are exporting ${selectedStories.length} file(s). This export may contain PII or named customer data. Continue?`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    let successCount = 0;
    let failedCount = 0;
    for (const story of selectedStories) {
      try {
        const blob = await downloadStoryExport(story.id, format);
        const safeTitle = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        saveBlob(blob, `${safeTitle || "story"}.${format}`);
        successCount += 1;
      } catch { failedCount += 1; }
    }
    setBulkBusy(false);
    showToast(`Bulk export complete: ${successCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}.`);
  }, [selectedStories, showToast]);

  const handleBulkExport = useCallback((format: "pdf" | "docx") => {
    if (selectedStories.length === 0) return;
    if (selectedStories.length > 5) {
      setConfirmState({ title: "Bulk Export", message: `Are you sure you want to export ${selectedStories.length} files as ${format.toUpperCase()}? Your browser will download them one by one.`, action: () => void doBulkExport(format) });
      return;
    }
    void doBulkExport(format);
  }, [selectedStories, doBulkExport]);

  const handleBulkDelete = useCallback(() => {
    if (isViewer || selectedStories.length === 0) return;
    const blocked = selectedStories.filter((story) => !!story.landing_page);
    const deletable = selectedStories.filter((story) => !story.landing_page);
    if (deletable.length === 0) { showToast("No selected stories can be deleted because they already have linked pages."); return; }
    const confirmText = [
      `Are you sure you want to delete ${deletable.length} selected stor${deletable.length === 1 ? "y" : "ies"}? This action cannot be undone.`,
      blocked.length > 0 ? ` ${blocked.length} stor${blocked.length === 1 ? "y has" : "ies have"} linked pages and will be skipped.` : "",
    ].join("");
    setConfirmState({
      title: "Delete Selected Stories",
      message: confirmText,
      action: async () => {
        setBulkBusy(true);
        const deletedIds: string[] = [];
        for (const story of deletable) {
          try { await deleteStory(story.id); deletedIds.push(story.id); } catch { /* best-effort */ }
        }
        const deletedSet = new Set(deletedIds);
        setStories((prev) => prev.filter((story) => !deletedSet.has(story.id)));
        setSelectedStoryIds((prev) => prev.filter((id) => !deletedSet.has(id)));
        setTotalCount((prev) => Math.max(0, prev - deletedIds.length));
        setBulkBusy(false);
        showToast(`Deleted ${deletedIds.length} stor${deletedIds.length === 1 ? "y" : "ies"}${blocked.length > 0 ? `, skipped ${blocked.length}` : ""}.`, "success");
      },
    });
  }, [isViewer, selectedStories, showToast]);

  const openCommentThread = useCallback((story: StoryLibraryItem) => {
    setCommentStory(story);
    setCommentTarget(story.landing_page ? "page" : "story");
    setCommentDraft("");
    setComments([]);
    setCommentsError(null);
    trackStoryLibraryAction(story, "library_action", "open_comment_thread");
  }, []);

  const closeCommentThread = useCallback(() => {
    setCommentStory(null);
    setCommentDraft("");
    setComments([]);
    setCommentsError(null);
  }, []);

  const submitComment = useCallback(async () => {
    if (!commentStory || !commentDraft.trim()) return;
    setCommentSubmitting(true);
    setCommentsError(null);
    try {
      const created = await createStoryComment(commentStory.id, { message: commentDraft.trim(), target: commentTarget, page_id: commentTarget === "page" ? commentStory.landing_page?.id : undefined });
      setComments((prev) => [...prev, created]);
      setCommentDraft("");
      trackStoryLibraryAction(commentStory, "library_action", "post_comment", { target: commentTarget });
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentStory, commentDraft, commentTarget]);

  return {
    loading,
    error,
    stories,
    searchDraft, setSearchDraft,
    search,
    searchMode, setSearchMode,
    status, setStatus,
    storyType, setStoryType,
    funnelStage, setFunnelStage,
    topic, setTopic,
    viewMode, setViewMode,
    page, setPage,
    pageSize, setPageSize,
    totalPages,
    totalCount,
    rangeStart, rangeEnd,
    busyStoryId,
    selectedStoryIds,
    bulkBusy,
    allSelectedOnPage,
    isViewer,
    uniqueStoryTypes,
    availableFunnelStages,
    availableTopics,
    funnelStageCounts,
    topicCounts,
    confirmState, setConfirmState,
    commentStory,
    commentTarget, setCommentTarget,
    comments,
    commentsLoading,
    commentsError,
    commentDraft, setCommentDraft,
    commentSubmitting,
    handleExport,
    handleCreateOrEditPage,
    handleShare,
    handleDelete,
    handleCopyStoryMarkdown,
    handleCopyCrmNote,
    handlePushCrmNote,
    toggleStorySelection,
    toggleSelectAllOnPage,
    handleBulkCopy,
    handleBulkExport,
    handleBulkDelete,
    openCommentThread,
    closeCommentThread,
    submitComment,
  };
}
