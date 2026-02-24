import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createLandingPage,
  deleteStory,
  downloadStoryExport,
  getStoryLibrary,
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

export function StoryLibraryPage({ userRole }: { userRole: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryLibraryItem[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | StoryLibraryItem["story_status"]>("ALL");
  const [storyType, setStoryType] = useState("ALL");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [busyStoryId, setBusyStoryId] = useState<string | null>(null);

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
      limit: 20,
      search: search || undefined,
      story_type: storyType === "ALL" ? undefined : storyType,
      status: status === "ALL" ? undefined : status,
    })
      .then((res) => {
        if (cancelled) return;
        setStories(res.stories);
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
  }, [page, search, status, storyType]);

  const uniqueStoryTypes = useMemo(() => {
    return Array.from(new Set(stories.map((s) => s.story_type))).sort();
  }, [stories]);

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
    } finally {
      setBusyStoryId(null);
    }
  };

  const handleCreateOrEditPage = async (story: StoryLibraryItem) => {
    setBusyStoryId(story.id);
    try {
      if (story.landing_page?.id) {
        navigate(`/pages/${story.landing_page.id}/edit`);
        return;
      }
      const page = await createLandingPage({
        story_id: story.id,
        title: story.title,
      });
      navigate(`/pages/${page.id}/edit`);
    } finally {
      setBusyStoryId(null);
    }
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
    } finally {
      setBusyStoryId(null);
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
      </div>

      <div className="story-library__count" aria-live="polite">
        {loading ? "Loading..." : `${totalCount} stor${totalCount === 1 ? "y" : "ies"}`}
      </div>

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
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
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
                    <td>
                      <strong>{story.title}</strong>
                    </td>
                    <td>
                      <Link to={`/accounts/${story.account.id}`}>{story.account.name}</Link>
                    </td>
                    <td>{STORY_TYPE_LABELS[story.story_type] ?? story.story_type}</td>
                    <td>{STORY_STATUS_LABELS[story.story_status]}</td>
                    <td>{new Date(story.generated_at).toLocaleDateString()}</td>
                    <td>
                      <div className="story-library__actions">
                        {!isViewer && (
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary"
                            onClick={() => void handleCreateOrEditPage(story)}
                            disabled={busyStoryId === story.id}
                          >
                            {story.landing_page ? "Edit Page" : "Create Page"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => void handleExport(story, "pdf")}
                          disabled={busyStoryId === story.id}
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => void handleExport(story, "docx")}
                          disabled={busyStoryId === story.id}
                        >
                          DOCX
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => navigator.clipboard.writeText(story.markdown)}
                          disabled={busyStoryId === story.id}
                        >
                          Copy
                        </button>
                        {!isViewer && (
                          <button
                            type="button"
                            className="btn btn--sm btn--danger"
                            onClick={() => void handleDelete(story)}
                            disabled={busyStoryId === story.id || !!story.landing_page}
                            title={story.landing_page ? "Delete page first to remove this story" : "Delete story"}
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
    </div>
  );
}
