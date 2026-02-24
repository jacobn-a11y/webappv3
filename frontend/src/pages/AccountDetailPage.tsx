import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StoryGeneratorModal } from "../components/StoryGeneratorModal";
import { Breadcrumb } from "../components/Breadcrumb";
import {
  createLandingPage,
  deleteStory,
  downloadStoryExport,
  getAccountStories,
  getChatAccounts,
  type StorySummary,
} from "../lib/api";
import { STORY_TYPE_LABELS } from "../types/taxonomy";

const STORY_STATUS_LABELS: Record<StorySummary["story_status"], string> = {
  DRAFT: "Draft",
  PAGE_CREATED: "Page Created",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

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

export function AccountDetailPage({ userRole }: { userRole?: string }) {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountName, setAccountName] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const isViewer = userRole === "VIEWER";

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    Promise.all([getAccountStories(accountId), getChatAccounts(accountId)])
      .then(([storiesRes, accountsRes]) => {
        setStories(storiesRes.stories);
        const exact = accountsRes.accounts.find((account) => account.id === accountId);
        if (exact?.name) {
          setAccountName(exact.name);
        }
      })
      .catch(() => {
        setStories([]);
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => {
    if (isViewer) return;
    if (searchParams.get("newStory") !== "1") return;
    setShowModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete("newStory");
    setSearchParams(next, { replace: true });
  }, [isViewer, searchParams, setSearchParams]);

  const refreshStories = () => {
    if (!accountId) return;
    getAccountStories(accountId)
      .then((res) => setStories(res.stories))
      .catch(() => {});
  };

  const handleLandingPageCreated = (pageId: string, _slug: string) => {
    setShowModal(false);
    navigate(`/pages/${pageId}/edit`);
  };

  const uniqueTypes = useMemo(() => {
    return Array.from(new Set(stories.map((story) => story.story_type))).sort();
  }, [stories]);

  const filteredStories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stories.filter((story) => {
      const matchesQuery =
        needle.length === 0 ||
        story.title.toLowerCase().includes(needle) ||
        story.markdown.toLowerCase().includes(needle);
      const matchesType = typeFilter === "ALL" || story.story_type === typeFilter;
      const matchesStatus =
        statusFilter === "ALL" || story.story_status === statusFilter;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [stories, query, typeFilter, statusFilter]);

  if (!accountId) {
    return <div className="page-error" role="alert">No account ID provided.</div>;
  }

  const displayAccountName = accountName || accountId;

  return (
    <div className="account-detail">
      <Breadcrumb items={[
        { label: "Home", to: "/" },
        { label: "Accounts", to: "/accounts" },
        { label: displayAccountName },
      ]} />

      <header className="account-detail__header">
        <div>
          <h1 className="account-detail__title">{displayAccountName}</h1>
          <p className="account-detail__id">ID: {accountId}</p>
        </div>
        <div className="account-detail__actions">
          {isViewer && <span className="account-detail__viewer-tag">View Only</span>}
          {!isViewer && (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={() => setShowModal(true)}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 2v14M2 9h14" />
              </svg>
              Generate Story
            </button>
          )}
          <Link to={`/accounts/${accountId}/journey`} className="btn btn--ghost">
            View Journey
          </Link>
        </div>
      </header>

      <section className="account-detail__stories">
        <div className="account-detail__stories-header">
          <h2 className="section-title">Generated Stories</h2>
          {stories.length > 0 && (
            <span className="account-detail__stories-count">
              {filteredStories.length} of {stories.length}
            </span>
          )}
        </div>

        {loading && (
          <div className="stories-loading" role="status" aria-live="polite">
            <div className="loading-state__spinner loading-state__spinner--sm" aria-hidden="true" />
            <span>Loading stories...</span>
          </div>
        )}

        {!loading && stories.length === 0 && (
          <div className="stories-empty">
            <div className="stories-empty__icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="8" y="6" width="32" height="36" rx="3" />
                <path d="M16 14h16M16 20h16M16 26h10" />
              </svg>
            </div>
            <h3>No stories yet</h3>
            <p>
              {isViewer
                ? "No stories have been generated for this account."
                : "Generate your first story in one click, then edit it directly as a landing page."}
            </p>
            {!isViewer && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setShowModal(true)}
              >
                Generate Story
              </button>
            )}
          </div>
        )}

        {!loading && stories.length > 0 && (
          <>
            <div className="story-filters">
              <input
                type="search"
                className="form-field__input"
                placeholder="Search stories by title or content"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search stories"
              />
              <select
                className="form-field__input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by story type"
              >
                <option value="ALL">All Types</option>
                {uniqueTypes.map((storyType) => (
                  <option key={storyType} value={storyType}>
                    {STORY_TYPE_LABELS[storyType] ?? storyType}
                  </option>
                ))}
              </select>
              <select
                className="form-field__input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by story status"
              >
                <option value="ALL">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PAGE_CREATED">Page Created</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>

            {filteredStories.length === 0 ? (
              <div className="stories-empty stories-empty--compact">
                <h3>No stories match your filters</h3>
                <p>Try a broader search or clear one of the filters.</p>
              </div>
            ) : (
              <div className="stories-grid">
                {filteredStories.map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    canEdit={!isViewer}
                    onOpenPage={(pageId) => navigate(`/pages/${pageId}/edit`)}
                    onDeleted={(storyId) =>
                      setStories((prev) => prev.filter((entry) => entry.id !== storyId))
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {showModal && (
        <StoryGeneratorModal
          accountId={accountId}
          accountName={displayAccountName}
          onClose={() => {
            setShowModal(false);
            refreshStories();
          }}
          onLandingPageCreated={handleLandingPageCreated}
        />
      )}
    </div>
  );
}

function StoryCard({
  story,
  canEdit,
  onOpenPage,
  onDeleted,
}: {
  story: StorySummary;
  canEdit: boolean;
  onOpenPage: (pageId: string) => void;
  onDeleted: (storyId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(story.markdown);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Ignore clipboard failures.
    }
  };

  const handleDownload = () => {
    const safeTitle = story.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    const blob = new Blob([story.markdown], { type: "text/markdown;charset=utf-8" });
    saveBlob(blob, `${safeTitle || "story"}.md`);
  };

  const handleDownloadExport = async (format: "pdf" | "docx") => {
    const safeTitle = story.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    setExportingFormat(format);
    setPageError(null);
    try {
      const blob = await downloadStoryExport(story.id, format);
      saveBlob(blob, `${safeTitle || "story"}.${format}`);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to export story");
    } finally {
      setExportingFormat(null);
    }
  };

  const handlePageAction = async () => {
    if (story.landing_page?.id) {
      onOpenPage(story.landing_page.id);
      return;
    }

    setCreatingPage(true);
    setPageError(null);
    try {
      const page = await createLandingPage({ story_id: story.id, title: story.title });
      onOpenPage(page.id);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to create page");
    } finally {
      setCreatingPage(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    const confirmed = window.confirm(
      `Delete story "${story.title}"? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteStory(story.id);
      onDeleted(story.id);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to delete story");
    } finally {
      setDeleting(false);
    }
  };

  const typeLabel = STORY_TYPE_LABELS[story.story_type] ?? story.story_type;
  const statusLabel = STORY_STATUS_LABELS[story.story_status];
  const previewId = `story-preview-${story.id}`;

  return (
    <div className="story-card">
      <div className="story-card__header">
        <div>
          <h3 className="story-card__title">{story.title}</h3>
          <div className="story-card__meta">
            <span className="story-card__badge">{typeLabel}</span>
            <span className={`story-card__status story-card__status--${story.story_status.toLowerCase()}`}>
              {statusLabel}
            </span>
            <span className="story-card__date">
              {new Date(story.generated_at).toLocaleDateString()}
            </span>
            {story.quotes.length > 0 && (
              <span className="story-card__quotes">
                {story.quotes.length} quote{story.quotes.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="story-card__actions">
          <button
            type="button"
            className={`btn btn--sm btn--ghost ${copyFeedback ? "btn--success" : ""}`}
            onClick={handleCopy}
          >
            {copyFeedback ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={handleDownload}>
            Download .md
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void handleDownloadExport("pdf")}
            disabled={exportingFormat !== null}
          >
            {exportingFormat === "pdf" ? "Exporting..." : "PDF"}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void handleDownloadExport("docx")}
            disabled={exportingFormat !== null}
          >
            {exportingFormat === "docx" ? "Exporting..." : "DOCX"}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={handlePageAction}
              disabled={creatingPage || exportingFormat !== null || deleting}
            >
              {creatingPage
                ? "Opening..."
                : story.landing_page?.id
                  ? "Edit Page"
                  : "Create Landing Page"}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => void handleDelete()}
              disabled={deleting || creatingPage || exportingFormat !== null || !!story.landing_page}
              title={story.landing_page ? "Delete page first to remove this story" : "Delete story"}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={previewId}
          >
            {expanded ? "Collapse" : "Preview"}
          </button>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" role="status">
        {copyFeedback ? "Story copied to clipboard." : ""}
      </div>
      {pageError && <div className="story-card__error" role="alert">{pageError}</div>}

      {expanded && (
        <div className="story-card__preview" id={previewId}>
          <article className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {story.markdown}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}
