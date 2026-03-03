import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createStoryComment,
  createLandingPage,
  deleteStory,
  downloadStoryExport,
  getStoryComments,
  getStoryLibrary,
  requestWriteback,
  trackSellerAdoptionEvent,
  type StoryComment,
  type StoryLibraryItem,
} from "../lib/api";
import { STORY_TYPE_LABELS } from "../types/taxonomy";

const STORY_STATUS_LABELS: Record<
  StoryLibraryItem["story_status"],
  string
> = {
  DRAFT: "Draft",
  PAGE_CREATED: "Page Created",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

const STORY_STATUS_HINTS: Record<StoryLibraryItem["story_status"], string> = {
  DRAFT: "Story is generated but not yet packaged into a page.",
  PAGE_CREATED: "Landing page exists and can be finalized for share.",
  PUBLISHED: "Published and share-ready.",
  ARCHIVED: "Archived and hidden from active workflows.",
};

const STORY_STATUS_BADGES: Record<StoryLibraryItem["story_status"], string> = {
  DRAFT: "badge--draft",
  PAGE_CREATED: "badge--accent",
  PUBLISHED: "badge--success",
  ARCHIVED: "badge--archived",
};

export function StoryLibraryPage({ userRole }: { userRole: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryLibraryItem[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | StoryLibraryItem["story_status"]>("ALL");
  const [storyType, setStoryType] = useState("ALL");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [serverLimit, setServerLimit] = useState(20);
  const [busyStoryId, setBusyStoryId] = useState<string | null>(null);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [commentStory, setCommentStory] = useState<StoryLibraryItem | null>(null);
  const [commentTarget, setCommentTarget] = useState<"story" | "page">("story");
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const isViewer = userRole === "VIEWER";

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void getStoryLibrary({
      page,
      limit: pageSize,
      search: search || undefined,
      story_type: storyType === "ALL" ? undefined : storyType,
      status: status === "ALL" ? undefined : status,
    })
      .then((res) => {
        if (cancelled) return;
        setStories(res.stories);
        setServerLimit(res.pagination.limit);
        setTotalPages(Math.max(res.pagination.totalPages, 1));
        setTotalCount(res.pagination.totalCount);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load story library");
        setStories([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, search, status, storyType]);

  const uniqueStoryTypes = useMemo(() => {
    return Object.keys(STORY_TYPE_LABELS).sort();
  }, []);
  const selectedStories = useMemo(() => {
    const selectedSet = new Set(selectedStoryIds);
    return stories.filter((story) => selectedSet.has(story.id));
  }, [selectedStoryIds, stories]);
  const allSelectedOnPage =
    stories.length > 0 && selectedStoryIds.length === stories.length;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * serverLimit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(rangeStart + serverLimit - 1, totalCount);

  useEffect(() => {
    setSelectedStoryIds([]);
    setBulkMessage(null);
  }, [page, search, storyType, status]);

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
      .then((res) => {
        if (cancelled) return;
        setComments(res.comments);
      })
      .catch((err) => {
        if (cancelled) return;
        setCommentsError(err instanceof Error ? err.message : "Failed to load comments");
      })
      .finally(() => {
        if (!cancelled) {
          setCommentsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commentStory, commentTarget]);

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const getStoryPreview = (markdown: string): string => {
    return markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/[>#*_~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);
  };

  const getStoryConfidence = (story: StoryLibraryItem): number | null => {
    const scores = story.quotes
      .map((quote) => quote.confidence_score)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (scores.length === 0) {
      return null;
    }
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  };

  const trackStoryLibraryAction = (
    story: StoryLibraryItem,
    eventType: "share_action" | "library_action",
    actionName: string,
    metadata?: Record<string, unknown>
  ) => {
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
  };

  const handleExport = async (story: StoryLibraryItem, format: "pdf" | "docx") => {
    setBusyStoryId(story.id);
    try {
      const blob = await downloadStoryExport(story.id, format);
      const safeTitle = story.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      saveBlob(blob, `${safeTitle || "story"}.${format}`);
      trackStoryLibraryAction(story, "share_action", `export_${format}`);
    } finally {
      setBusyStoryId(null);
    }
  };

  const handleCreateOrEditPage = async (story: StoryLibraryItem) => {
    setBusyStoryId(story.id);
    try {
      if (story.landing_page?.id) {
        trackStoryLibraryAction(story, "library_action", "open_page_editor", {
          page_id: story.landing_page.id,
        });
        navigate(`/pages/${story.landing_page.id}/edit`);
        return;
      }
      const page = await createLandingPage({
        story_id: story.id,
        title: story.title,
      });
      trackStoryLibraryAction(story, "share_action", "create_page", {
        page_id: page.id,
        page_slug: page.slug,
      });
      navigate(`/pages/${page.id}/edit`);
    } finally {
      setBusyStoryId(null);
    }
  };

  const handleShare = async (story: StoryLibraryItem) => {
    if (story.landing_page?.slug) {
      const shareUrl = `${window.location.origin}/p/${story.landing_page.slug}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setBulkMessage(`Share link copied for "${story.title}".`);
      trackStoryLibraryAction(story, "share_action", "copy_share_link", {
        url: shareUrl,
      });
      return;
    }
    setBulkMessage(
      story.landing_page
        ? "Page exists but is not published yet. Open the editor to publish first."
        : "Create a landing page first, then publish to get a share link."
    );
    trackStoryLibraryAction(story, "library_action", "share_blocked", {
      has_page: !!story.landing_page,
      page_status: story.landing_page?.status ?? null,
    });
  };

  const handleDelete = async (story: StoryLibraryItem) => {
    const confirmed = window.confirm(
      `Delete story \"${story.title}\"? This cannot be undone.`
    );
    if (!confirmed) return;

    setBusyStoryId(story.id);
    try {
      await deleteStory(story.id);
      setStories((prev) => prev.filter((s) => s.id !== story.id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      trackStoryLibraryAction(story, "library_action", "delete_story");
    } finally {
      setBusyStoryId(null);
    }
  };

  const buildCrmNote = (story: StoryLibraryItem): string => {
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
  };

  const handleCopyStoryMarkdown = async (story: StoryLibraryItem) => {
    await navigator.clipboard.writeText(story.markdown);
    setBulkMessage(`Copied story markdown for "${story.title}".`);
    trackStoryLibraryAction(story, "share_action", "copy_story_markdown");
  };

  const handleCopyCrmNote = async (story: StoryLibraryItem) => {
    const note = buildCrmNote(story);
    await navigator.clipboard.writeText(note);
    setBulkMessage(`Copied CRM note for "${story.title}".`);
    trackStoryLibraryAction(story, "share_action", "copy_crm_note");
  };

  const handlePushCrmNote = async (story: StoryLibraryItem) => {
    const confirmed = window.confirm(
      `Push a CRM note for "${story.title}" to account "${story.account.name}"?`
    );
    if (!confirmed) {
      return;
    }
    setBusyStoryId(story.id);
    try {
      await requestWriteback({
        action_type: "NOTE",
        account_id: story.account.id,
        title: `StoryEngine: ${story.title}`,
        body: buildCrmNote(story),
        metadata: {
          source: "story_library",
          story_id: story.id,
        },
      });
      setBulkMessage(`Queued CRM note writeback for "${story.title}".`);
      trackStoryLibraryAction(story, "share_action", "push_crm_note");
    } catch (err) {
      setBulkMessage(
        err instanceof Error
          ? `CRM writeback failed: ${err.message}`
          : "CRM writeback failed."
      );
    } finally {
      setBusyStoryId(null);
    }
  };

  const toggleStorySelection = (storyId: string) => {
    setSelectedStoryIds((prev) =>
      prev.includes(storyId)
        ? prev.filter((id) => id !== storyId)
        : [...prev, storyId]
    );
  };

  const toggleSelectAllOnPage = () => {
    if (allSelectedOnPage) {
      setSelectedStoryIds([]);
      return;
    }
    setSelectedStoryIds(stories.map((story) => story.id));
  };

  const handleBulkCopy = async () => {
    if (selectedStories.length === 0) {
      return;
    }
    const payload = selectedStories
      .map(
        (story) =>
          `# ${story.title}\n\nAccount: ${story.account.name}\nStatus: ${STORY_STATUS_LABELS[story.story_status]}\n\n${story.markdown}`
      )
      .join("\n\n---\n\n");
    await navigator.clipboard.writeText(payload);
    setBulkMessage(
      `Copied ${selectedStories.length} stor${selectedStories.length === 1 ? "y" : "ies"} to clipboard.`
    );
  };

  const handleBulkExport = async (format: "pdf" | "docx") => {
    if (selectedStories.length === 0) {
      return;
    }
    if (
      selectedStories.length > 5 &&
      !window.confirm(
        `Export ${selectedStories.length} files as ${format.toUpperCase()}? Your browser will download them one by one.`
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
        const safeTitle = story.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80);
        saveBlob(blob, `${safeTitle || "story"}.${format}`);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    setBulkBusy(false);
    setBulkMessage(
      `Bulk export complete: ${successCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}.`
    );
  };

  const handleBulkDelete = async () => {
    if (isViewer || selectedStories.length === 0) {
      return;
    }
    const blocked = selectedStories.filter((story) => !!story.landing_page);
    const deletable = selectedStories.filter((story) => !story.landing_page);
    if (deletable.length === 0) {
      setBulkMessage(
        "No selected stories can be deleted because they already have linked pages."
      );
      return;
    }
    const confirmText = [
      `Delete ${deletable.length} selected stor${deletable.length === 1 ? "y" : "ies"}?`,
      blocked.length > 0
        ? `${blocked.length} stor${blocked.length === 1 ? "y has" : "ies have"} linked pages and will be skipped.`
        : "This cannot be undone.",
    ].join("\n");
    if (!window.confirm(confirmText)) {
      return;
    }

    setBulkBusy(true);
    const deletedIds: string[] = [];
    for (const story of deletable) {
      try {
        await deleteStory(story.id);
        deletedIds.push(story.id);
      } catch {
        // best-effort bulk delete
      }
    }
    const deletedSet = new Set(deletedIds);
    setStories((prev) => prev.filter((story) => !deletedSet.has(story.id)));
    setSelectedStoryIds((prev) => prev.filter((id) => !deletedSet.has(id)));
    setTotalCount((prev) => Math.max(0, prev - deletedIds.length));
    setBulkBusy(false);
    setBulkMessage(
      `Deleted ${deletedIds.length} stor${deletedIds.length === 1 ? "y" : "ies"}${blocked.length > 0 ? `, skipped ${blocked.length}` : ""}.`
    );
  };

  const openCommentThread = (story: StoryLibraryItem) => {
    setCommentStory(story);
    setCommentTarget(story.landing_page ? "page" : "story");
    setCommentDraft("");
    setComments([]);
    setCommentsError(null);
    trackStoryLibraryAction(story, "library_action", "open_comment_thread");
  };

  const closeCommentThread = () => {
    setCommentStory(null);
    setCommentDraft("");
    setComments([]);
    setCommentsError(null);
  };

  const submitComment = async () => {
    if (!commentStory || !commentDraft.trim()) {
      return;
    }
    setCommentSubmitting(true);
    setCommentsError(null);
    try {
      const created = await createStoryComment(commentStory.id, {
        message: commentDraft.trim(),
        target: commentTarget,
        page_id: commentTarget === "page" ? commentStory.landing_page?.id : undefined,
      });
      setComments((prev) => [...prev, created]);
      setCommentDraft("");
      trackStoryLibraryAction(commentStory, "library_action", "post_comment", {
        target: commentTarget,
      });
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setCommentSubmitting(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Story Library</h1>
          <p className="page__subtitle">
            Browse stories across all accessible accounts.
          </p>
        </div>
      </header>

      <div className="story-library__controls">
        <input
          type="search"
          className="form-field__input"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search by title, account, or content"
          aria-label="Search story library"
        />
        <select
          className="form-field__input"
          value={storyType}
          onChange={(e) => {
            setStoryType(e.target.value);
            setPage(1);
          }}
          aria-label="Filter story type"
        >
          <option value="ALL">All Types</option>
          {uniqueStoryTypes.map((type) => (
            <option key={type} value={type}>
              {STORY_TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
        <select
          className="form-field__input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "ALL" | StoryLibraryItem["story_status"]);
            setPage(1);
          }}
          aria-label="Filter story status"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PAGE_CREATED">Page Created</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select
          className="form-field__input"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
          aria-label="Stories per page"
        >
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        <div className="story-library__view-toggle" role="group" aria-label="Library view mode">
          <button
            type="button"
            className={`btn btn--sm ${viewMode === "cards" ? "btn--primary" : "btn--secondary"}`}
            onClick={() => setViewMode("cards")}
          >
            Seller Cards
          </button>
          <button
            type="button"
            className={`btn btn--sm ${viewMode === "table" ? "btn--primary" : "btn--secondary"}`}
            onClick={() => setViewMode("table")}
          >
            Bulk Table
          </button>
        </div>
      </div>

      <div className="story-library__count" aria-live="polite">
        {loading
          ? "Loading..."
          : `${rangeStart}-${rangeEnd} of ${totalCount} stor${totalCount === 1 ? "y" : "ies"}`}
      </div>

      {!loading && stories.length > 0 && viewMode === "table" && (
        <div className="story-library__bulk">
          <label className="story-library__bulk-select">
            <input
              type="checkbox"
              checked={allSelectedOnPage}
              onChange={toggleSelectAllOnPage}
              aria-label="Select all stories on this page"
            />
            Select all on page
          </label>
          <span className="story-library__bulk-count">
            {selectedStoryIds.length} selected
          </span>
          <div className="story-library__bulk-actions">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void handleBulkCopy()}
              disabled={selectedStoryIds.length === 0 || bulkBusy}
            >
              Copy Selected
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void handleBulkExport("pdf")}
              disabled={selectedStoryIds.length === 0 || bulkBusy}
            >
              Export PDFs
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void handleBulkExport("docx")}
              disabled={selectedStoryIds.length === 0 || bulkBusy}
            >
              Export DOCX
            </button>
            {!isViewer && (
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => void handleBulkDelete()}
                disabled={selectedStoryIds.length === 0 || bulkBusy}
              >
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {bulkMessage && (
        <div className="story-library__bulk-message" role="status" aria-live="polite">
          {bulkMessage}
        </div>
      )}

      {loading && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading story library...</div>
        </div>
      )}

      {!loading && error && (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Failed to load story library</div>
          <div className="state-view__message">{error}</div>
        </div>
      )}

      {!loading && !error && stories.length === 0 && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="state-view__title">No stories found</div>
          <div className="state-view__message">
            Try broadening your filters, or generate a new story from Accounts.
          </div>
        </div>
      )}

      {!loading && !error && stories.length > 0 && (
        <>
          {viewMode === "cards" ? (
            <div className="story-library__card-grid">
              {stories.map((story) => {
                const confidence = getStoryConfidence(story);
                const confidencePct =
                  confidence != null ? `${Math.round(confidence * 100)}%` : "N/A";
                const confidenceSafe = confidence != null && confidence >= 0.72;
                const topQuote = story.quotes[0]?.quote_text ?? "No proof quote captured yet.";

                return (
                  <article key={story.id} className="story-library__card">
                    <header className="story-library__card-header">
                      <div>
                        <h3 className="story-library__card-title">{story.title}</h3>
                        <p className="story-library__card-meta">
                          <Link to={`/accounts/${story.account.id}`}>{story.account.name}</Link>
                          {" · "}
                          {new Date(story.generated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="story-library__card-badges">
                        <span className={`badge ${STORY_STATUS_BADGES[story.story_status]}`}>
                          {STORY_STATUS_LABELS[story.story_status]}
                        </span>
                        <span
                          className={`badge ${
                            confidenceSafe ? "badge--success" : "badge--draft"
                          }`}
                        >
                          {confidenceSafe ? "Safe to Share" : "Review"} · {confidencePct}
                        </span>
                      </div>
                    </header>
                    <p className="story-library__card-preview">{getStoryPreview(story.markdown)}</p>
                    <blockquote className="story-library__card-quote">"{topQuote}"</blockquote>
                    <div className="story-library__card-actions">
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => void handleShare(story)}
                        disabled={busyStoryId === story.id || bulkBusy}
                      >
                        Share
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void handleCopyStoryMarkdown(story)}
                        disabled={busyStoryId === story.id || bulkBusy}
                      >
                        Copy
                      </button>
                      {!isViewer && (
                        <button
                          type="button"
                          className="btn btn--sm btn--secondary"
                          onClick={() => void handleCreateOrEditPage(story)}
                          disabled={busyStoryId === story.id || bulkBusy}
                        >
                          {story.landing_page ? "Edit Page" : "Create Page"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void handleExport(story, "pdf")}
                        disabled={busyStoryId === story.id || bulkBusy}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void handleExport(story, "docx")}
                        disabled={busyStoryId === story.id || bulkBusy}
                      >
                        DOCX
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void handleCopyCrmNote(story)}
                        disabled={busyStoryId === story.id || bulkBusy}
                      >
                        Copy CRM Note
                      </button>
                      {!isViewer && (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => void handlePushCrmNote(story)}
                          disabled={busyStoryId === story.id || bulkBusy}
                        >
                          Push CRM Note
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => openCommentThread(story)}
                        disabled={bulkBusy}
                      >
                        Comments
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="story-library__select-col">Select</th>
                    <th>Story</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stories.map((story) => (
                    <tr key={story.id}>
                      <td className="story-library__select-col">
                        <input
                          type="checkbox"
                          checked={selectedStoryIds.includes(story.id)}
                          onChange={() => toggleStorySelection(story.id)}
                          aria-label={`Select story ${story.title}`}
                        />
                      </td>
                      <td>
                        <strong>{story.title}</strong>
                      </td>
                      <td>
                        <Link to={`/accounts/${story.account.id}`}>{story.account.name}</Link>
                      </td>
                      <td>{STORY_TYPE_LABELS[story.story_type] ?? story.story_type}</td>
                      <td>
                        <div className="story-library__status-cell">
                          <span className={`badge ${STORY_STATUS_BADGES[story.story_status]}`}>
                            {STORY_STATUS_LABELS[story.story_status]}
                          </span>
                          <span className="story-library__status-hint">
                            {STORY_STATUS_HINTS[story.story_status]}
                          </span>
                        </div>
                      </td>
                      <td>{new Date(story.generated_at).toLocaleDateString()}</td>
                      <td>
                        <div className="story-library__actions">
                          <button
                            type="button"
                            className="btn btn--sm btn--primary"
                            onClick={() => void handleShare(story)}
                            disabled={busyStoryId === story.id || bulkBusy}
                          >
                            Share
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => void handleCopyStoryMarkdown(story)}
                            disabled={busyStoryId === story.id || bulkBusy}
                          >
                            Copy
                          </button>
                          {!isViewer && (
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              onClick={() => void handleCreateOrEditPage(story)}
                              disabled={busyStoryId === story.id || bulkBusy}
                            >
                              {story.landing_page ? "Edit Page" : "Create Page"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => void handleExport(story, "pdf")}
                            disabled={busyStoryId === story.id || bulkBusy}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => void handleExport(story, "docx")}
                            disabled={busyStoryId === story.id || bulkBusy}
                          >
                            DOCX
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => void handleCopyCrmNote(story)}
                            disabled={busyStoryId === story.id || bulkBusy}
                          >
                            Copy CRM Note
                          </button>
                          {!isViewer && (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              onClick={() => void handlePushCrmNote(story)}
                              disabled={busyStoryId === story.id || bulkBusy}
                            >
                              Push CRM Note
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => openCommentThread(story)}
                            disabled={bulkBusy}
                          >
                            Comments
                          </button>
                          {!isViewer && (
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => void handleDelete(story)}
                              disabled={
                                busyStoryId === story.id || bulkBusy || !!story.landing_page
                              }
                              title={
                                story.landing_page
                                  ? "Delete page first to remove this story"
                                  : "Delete story"
                              }
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="story-library__pagination">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(totalPages, 1)}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}

      {commentStory && (
        <div className="story-library__comments-overlay" role="dialog" aria-modal="true">
          <div className="story-library__comments-modal">
            <div className="story-library__comments-header">
              <div>
                <h2 className="story-library__comments-title">Feedback Thread</h2>
                <p className="story-library__comments-subtitle">{commentStory.title}</p>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={closeCommentThread}
              >
                Close
              </button>
            </div>

            <div className="story-library__comments-targets">
              <button
                type="button"
                className={`btn btn--sm ${
                  commentTarget === "story" ? "btn--primary" : "btn--secondary"
                }`}
                onClick={() => setCommentTarget("story")}
              >
                Story Thread
              </button>
              {commentStory.landing_page && (
                <button
                  type="button"
                  className={`btn btn--sm ${
                    commentTarget === "page" ? "btn--primary" : "btn--secondary"
                  }`}
                  onClick={() => setCommentTarget("page")}
                >
                  Page Thread
                </button>
              )}
            </div>

            <div className="story-library__comments-list">
              {commentsLoading && (
                <div className="story-library__comments-empty">Loading comments...</div>
              )}
              {!commentsLoading && comments.length === 0 && (
                <div className="story-library__comments-empty">
                  No comments yet. Start the thread.
                </div>
              )}
              {!commentsLoading &&
                comments.map((comment) => (
                  <div className="story-library__comment" key={comment.id}>
                    <div className="story-library__comment-meta">
                      <strong>
                        {comment.author?.name || comment.author?.email || "Unknown user"}
                      </strong>
                      <span>{new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                    <div className="story-library__comment-body">{comment.message}</div>
                  </div>
                ))}
            </div>

            {commentsError && (
              <div className="story-library__comments-error" role="alert">
                {commentsError}
              </div>
            )}

            <div className="story-library__comments-compose">
              <textarea
                className="form-textarea"
                rows={3}
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add feedback for this story/page..."
                aria-label="Comment message"
              />
              <div className="story-library__comments-compose-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={closeCommentThread}
                  disabled={commentSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void submitComment()}
                  disabled={commentSubmitting || !commentDraft.trim()}
                >
                  {commentSubmitting ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
