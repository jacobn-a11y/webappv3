import { Link } from "react-router-dom";
import type { StoryLibraryItem } from "../../lib/api";
import {
  STORY_STATUS_LABELS,
  STORY_STATUS_BADGES,
  getStoryPreview,
  getStoryConfidence,
} from "./useStoryLibrary";

export interface StoryCardProps {
  story: StoryLibraryItem;
  busyStoryId: string | null;
  bulkBusy: boolean;
  isViewer: boolean;
  onShare: (story: StoryLibraryItem) => void;
  onCopy: (story: StoryLibraryItem) => void;
  onCreateOrEditPage: (story: StoryLibraryItem) => void;
  onExport: (story: StoryLibraryItem, format: "pdf" | "docx") => void;
  onCopyCrmNote: (story: StoryLibraryItem) => void;
  onPushCrmNote: (story: StoryLibraryItem) => void;
  onOpenComments: (story: StoryLibraryItem) => void;
}

export function StoryCard({
  story,
  busyStoryId,
  bulkBusy,
  isViewer,
  onShare,
  onCopy,
  onCreateOrEditPage,
  onExport,
  onCopyCrmNote,
  onPushCrmNote,
  onOpenComments,
}: StoryCardProps) {
  const confidence = getStoryConfidence(story);
  const confidencePct = confidence != null ? `${Math.round(confidence * 100)}%` : "N/A";
  const confidenceSafe = confidence != null && confidence >= 0.72;
  const topQuote = story.quotes[0]?.quote_text ?? "No proof quote captured yet.";

  return (
    <article className="story-library__card">
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
          <span className={`badge ${confidenceSafe ? "badge--success" : "badge--draft"}`}>
            {confidenceSafe ? "Safe to Share" : "Review"} · {confidencePct}
          </span>
        </div>
      </header>
      <p className="story-library__card-preview">{getStoryPreview(story.markdown)}</p>
      <blockquote className="story-library__card-quote">"{topQuote}"</blockquote>
      <div className="story-library__card-actions">
        <button type="button" className="btn btn--sm btn--primary" onClick={() => void onShare(story)} disabled={busyStoryId === story.id || bulkBusy}>
          Share
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopy(story)} disabled={busyStoryId === story.id || bulkBusy}>
          Copy
        </button>
        {!isViewer && (
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void onCreateOrEditPage(story)} disabled={busyStoryId === story.id || bulkBusy}>
            {story.landing_page ? "Edit Page" : "Create Page"}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onExport(story, "pdf")} disabled={busyStoryId === story.id || bulkBusy}>
          PDF
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onExport(story, "docx")} disabled={busyStoryId === story.id || bulkBusy}>
          DOCX
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopyCrmNote(story)} disabled={busyStoryId === story.id || bulkBusy}>
          Copy CRM Note
        </button>
        {!isViewer && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onPushCrmNote(story)} disabled={busyStoryId === story.id || bulkBusy}>
            Push CRM Note
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onOpenComments(story)} disabled={bulkBusy}>
          Comments
        </button>
      </div>
    </article>
  );
}
