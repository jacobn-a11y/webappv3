import { useState, useRef, useEffect } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const confidence = getStoryConfidence(story);
  const confidencePct = confidence != null ? `${Math.round(confidence * 100)}%` : "N/A";
  const confidenceSafe = confidence != null && confidence >= 0.72;
  const topQuote = story.quotes[0]?.quote_text ?? "No proof quote captured yet.";
  const busy = busyStoryId === story.id || bulkBusy;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("click", handleClick); document.removeEventListener("keydown", handleEscape); };
  }, [menuOpen]);

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
        <button type="button" className="btn btn--sm btn--primary" onClick={() => void onShare(story)} disabled={busy}>
          Share
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopy(story)} disabled={busy}>
          Copy
        </button>
        {!isViewer && (
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void onCreateOrEditPage(story)} disabled={busy}>
            {story.landing_page ? "Edit Page" : "Create Page"}
          </button>
        )}
        <div className="story-library__overflow" ref={menuRef}>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More actions for ${story.title}`}
          >
            &#8943;
          </button>
          {menuOpen && (
            <div className="story-library__overflow-menu" role="menu">
              <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setMenuOpen(false); void onExport(story, "pdf"); }} disabled={busy}>Export PDF</button>
              <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setMenuOpen(false); void onExport(story, "docx"); }} disabled={busy}>Export DOCX</button>
              <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setMenuOpen(false); void onCopyCrmNote(story); }} disabled={busy}>Copy CRM Note</button>
              {!isViewer && (
                <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setMenuOpen(false); void onPushCrmNote(story); }} disabled={busy}>Push CRM Note</button>
              )}
              <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setMenuOpen(false); onOpenComments(story); }} disabled={bulkBusy}>Comments</button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
