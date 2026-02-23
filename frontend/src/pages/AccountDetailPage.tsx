import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { StoryGeneratorModal } from "../components/StoryGeneratorModal";
import { Breadcrumb } from "../components/Breadcrumb";
import { getAccountStories, type StorySummary } from "../lib/api";
import { STORY_TYPE_LABELS } from "../types/taxonomy";

export function AccountDetailPage({ userRole }: { userRole?: string }) {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(true);

  // In a real app this would come from the account fetch.
  // For now, derive a placeholder from the URL or use a generic label.
  const accountName = "Account";

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    getAccountStories(accountId)
      .then((res) => setStories(res.stories))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

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

  if (!accountId) {
    return <div className="page-error" role="alert">No account ID provided.</div>;
  }

  const isViewer = userRole === "VIEWER";

  return (
    <div className="account-detail">
      <Breadcrumb items={[
        { label: "Home", to: "/" },
        { label: "Accounts", to: "/accounts/acc_meridian" },
        { label: "Account Detail" },
      ]} />

      {/* Page header */}
      <header className="account-detail__header">
        <div>
          <h1 className="account-detail__title">Account Detail</h1>
          <p className="account-detail__id">ID: {accountId}</p>
        </div>
        <div className="account-detail__actions">
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

      {/* Previous stories */}
      <section className="account-detail__stories">
        <h2 className="section-title">Generated Stories</h2>

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
            <p>{isViewer ? "No stories have been generated for this account." : "Generate your first story to see it here."}</p>
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
          <div className="stories-grid">
            {stories.map((story) => (
              <StoryCard key={story.id} story={story} />
            ))}
          </div>
        )}
      </section>

      {/* Story Generator Modal */}
      {showModal && (
        <StoryGeneratorModal
          accountId={accountId}
          accountName={accountName}
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

// ─── Story Card ──────────────────────────────────────────────────────────────

function StoryCard({ story }: { story: StorySummary }) {
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(story.markdown);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const typeLabel =
    STORY_TYPE_LABELS[story.story_type] ?? story.story_type;

  return (
    <div className="story-card">
      <div className="story-card__header">
        <div>
          <h3 className="story-card__title">{story.title}</h3>
          <div className="story-card__meta">
            <span className="story-card__badge">{typeLabel}</span>
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
            {copyFeedback ? "Copied!" : "Copy MD"}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Collapse" : "Preview"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="story-card__preview">
          <pre className="story-card__markdown">{story.markdown}</pre>
        </div>
      )}
    </div>
  );
}
