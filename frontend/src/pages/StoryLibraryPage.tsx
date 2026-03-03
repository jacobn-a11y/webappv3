import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createLandingPage,
  deleteStory,
  downloadStoryExport,
  getStoryLibrary,
  requestWriteback,
  trackSellerAdoptionEvent,
  type StoryLibraryItem,
} from "../lib/api";
import { saveBlob } from "../lib/download";
import { slugifyTitle } from "../lib/format";
import { STORY_TYPE_LABELS } from "../types/taxonomy";
import {
  STORY_STATUS_LABELS,
  STORY_STATUS_HINTS,
  STORY_STATUS_BADGES,
} from "../types/story-status";
import {
  StoryActionButtons,
  type StoryActionCallbacks,
} from "../components/StoryActionButtons";
import { StoryCommentThread } from "../components/StoryCommentThread";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStoryPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[>#*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function getStoryConfidence(story: StoryLibraryItem): number | null {
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
  metadata?: Record<string, unknown>,
) {
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

// ─── Main Component ──────────────────────────────────────────────────────────

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

  const isViewer = userRole === "VIEWER";

  // ─── Data Fetching ──────────────────────────────────────────────────

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

  // ─── Derived State ──────────────────────────────────────────────────

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

  // ─── Story Actions (shared between card + table views) ─────────────

  const storyCallbacks: StoryActionCallbacks = useMemo(() => ({
    onShare: (story) => void handleShare(story),
    onCopyMarkdown: (story) => void handleCopyStoryMarkdown(story),
    onCreateOrEditPage: (story) => void handleCreateOrEditPage(story),
    onExport: (story, format) => void handleExport(story, format),
    onCopyCrmNote: (story) => void handleCopyCrmNote(story),
    onPushCrmNote: (story) => void handlePushCrmNote(story),
    onOpenComments: (story) => {
      setCommentStory(story);
      trackStoryLibraryAction(story, "library_action", "open_comment_thread");
    },
    onDelete: (story) => void handleDelete(story),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- handlers use stable setters

  async function handleExport(story: StoryLibraryItem, format: "pdf" | "docx") {
    setBusyStoryId(story.id);
    try {
      const blob = await downloadStoryExport(story.id, format);
      saveBlob(blob, `${slugifyTitle(story.title) || "story"}.${format}`);
      trackStoryLibraryAction(story, "share_action", `export_${format}`);
    } finally {
      setBusyStoryId(null);
    }
  }

  async function handleCreateOrEditPage(story: StoryLibraryItem) {
    setBusyStoryId(story.id);
    try {
      if (story.landing_page?.id) {
        trackStoryLibraryAction(story, "library_action", "open_page_editor", {
          page_id: story.landing_page.id,
        });
        navigate(`/pages/${story.landing_page.id}/edit`);
        return;
      }
      const created = await createLandingPage({
        story_id: story.id,
        title: story.title,
      });
      trackStoryLibraryAction(story, "share_action", "create_page", {
        page_id: created.id,
        page_slug: created.slug,
      });
      navigate(`/pages/${created.id}/edit`);
    } finally {
      setBusyStoryId(null);
    }
  }

  async function handleShare(story: StoryLibraryItem) {
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
        : "Create a landing page first, then publish to get a share link.",
    );
    trackStoryLibraryAction(story, "library_action", "share_blocked", {
      has_page: !!story.landing_page,
      page_status: story.landing_page?.status ?? null,
    });
  }

  async function handleDelete(story: StoryLibraryItem) {
    const confirmed = window.confirm(
      `Delete story "${story.title}"? This cannot be undone.`,
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
  }

  async function handleCopyStoryMarkdown(story: StoryLibraryItem) {
    await navigator.clipboard.writeText(story.markdown);
    setBulkMessage(`Copied story markdown for "${story.title}".`);
    trackStoryLibraryAction(story, "share_action", "copy_story_markdown");
  }

  async function handleCopyCrmNote(story: StoryLibraryItem) {
    const note = buildCrmNote(story);
    await navigator.clipboard.writeText(note);
    setBulkMessage(`Copied CRM note for "${story.title}".`);
    trackStoryLibraryAction(story, "share_action", "copy_crm_note");
  }

  async function handlePushCrmNote(story: StoryLibraryItem) {
    const confirmed = window.confirm(
      `Push a CRM note for "${story.title}" to account "${story.account.name}"?`,
    );
    if (!confirmed) return;
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
          : "CRM writeback failed.",
      );
    } finally {
      setBusyStoryId(null);
    }
  }

  // ─── Bulk Actions ───────────────────────────────────────────────────

  const toggleStorySelection = (storyId: string) => {
    setSelectedStoryIds((prev) =>
      prev.includes(storyId)
        ? prev.filter((id) => id !== storyId)
        : [...prev, storyId],
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
    if (selectedStories.length === 0) return;
    const payload = selectedStories
      .map(
        (story) =>
          `# ${story.title}\n\nAccount: ${story.account.name}\nStatus: ${STORY_STATUS_LABELS[story.story_status]}\n\n${story.markdown}`,
      )
      .join("\n\n---\n\n");
    await navigator.clipboard.writeText(payload);
    setBulkMessage(
      `Copied ${selectedStories.length} stor${selectedStories.length === 1 ? "y" : "ies"} to clipboard.`,
    );
  };

  const handleBulkExport = async (format: "pdf" | "docx") => {
    if (selectedStories.length === 0) return;
    if (
      selectedStories.length > 5 &&
      !window.confirm(
        `Export ${selectedStories.length} files as ${format.toUpperCase()}? Your browser will download them one by one.`,
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
        saveBlob(blob, `${slugifyTitle(story.title) || "story"}.${format}`);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    setBulkBusy(false);
    setBulkMessage(
      `Bulk export complete: ${successCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}.`,
    );
  };

  const handleBulkDelete = async () => {
    if (isViewer || selectedStories.length === 0) return;
    const blocked = selectedStories.filter((story) => !!story.landing_page);
    const deletable = selectedStories.filter((story) => !story.landing_page);
    if (deletable.length === 0) {
      setBulkMessage(
        "No selected stories can be deleted because they already have linked pages.",
      );
      return;
    }
    const confirmText = [
      `Delete ${deletable.length} selected stor${deletable.length === 1 ? "y" : "ies"}?`,
      blocked.length > 0
        ? `${blocked.length} stor${blocked.length === 1 ? "y has" : "ies have"} linked pages and will be skipped.`
        : "This cannot be undone.",
    ].join("\n");
    if (!window.confirm(confirmText)) return;

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
      `Deleted ${deletedIds.length} stor${deletedIds.length === 1 ? "y" : "ies"}${blocked.length > 0 ? `, skipped ${blocked.length}` : ""}.`,
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────

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
                      <StoryActionButtons
                        story={story}
                        callbacks={storyCallbacks}
                        busy={busyStoryId === story.id || bulkBusy}
                        isViewer={isViewer}
                      />
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
                          <StoryActionButtons
                            story={story}
                            callbacks={storyCallbacks}
                            busy={busyStoryId === story.id || bulkBusy}
                            isViewer={isViewer}
                          />
                          {!isViewer && (
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => storyCallbacks.onDelete?.(story)}
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
        <StoryCommentThread
          story={commentStory}
          onClose={() => setCommentStory(null)}
          onTrack={(actionName, metadata) =>
            trackStoryLibraryAction(commentStory, "library_action", actionName, metadata)
          }
        />
      )}
    </div>
  );
}
