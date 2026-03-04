import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import type { StoryLibraryItem } from "../../lib/api";
import { STORY_TYPE_LABELS } from "../../types/taxonomy";
import {
  STORY_STATUS_LABELS,
  STORY_STATUS_BADGES,
  STORY_STATUS_HINTS,
} from "./useStoryLibrary";

export interface StoryTableProps {
  stories: StoryLibraryItem[];
  selectedStoryIds: string[];
  busyStoryId: string | null;
  bulkBusy: boolean;
  isViewer: boolean;
  onToggleSelection: (storyId: string) => void;
  onShare: (story: StoryLibraryItem) => void;
  onCopy: (story: StoryLibraryItem) => void;
  onCreateOrEditPage: (story: StoryLibraryItem) => void;
  onExport: (story: StoryLibraryItem, format: "pdf" | "docx") => void;
  onCopyCrmNote: (story: StoryLibraryItem) => void;
  onPushCrmNote: (story: StoryLibraryItem) => void;
  onOpenComments: (story: StoryLibraryItem) => void;
  onDelete: (story: StoryLibraryItem) => void;
}

function RowOverflow({
  story,
  busy,
  bulkBusy,
  isViewer,
  onExport,
  onCopyCrmNote,
  onPushCrmNote,
  onOpenComments,
  onDelete,
}: {
  story: StoryLibraryItem;
  busy: boolean;
  bulkBusy: boolean;
  isViewer: boolean;
  onExport: (story: StoryLibraryItem, format: "pdf" | "docx") => void;
  onCopyCrmNote: (story: StoryLibraryItem) => void;
  onPushCrmNote: (story: StoryLibraryItem) => void;
  onOpenComments: (story: StoryLibraryItem) => void;
  onDelete: (story: StoryLibraryItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("click", handleClick); document.removeEventListener("keydown", handleEscape); };
  }, [open]);

  return (
    <div className="story-library__overflow" ref={ref}>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${story.title}`}
      >
        &#8943;
      </button>
      {open && (
        <div className="story-library__overflow-menu" role="menu">
          <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setOpen(false); void onExport(story, "pdf"); }} disabled={busy}>Export PDF</button>
          <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setOpen(false); void onExport(story, "docx"); }} disabled={busy}>Export DOCX</button>
          <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setOpen(false); void onCopyCrmNote(story); }} disabled={busy}>Copy CRM Note</button>
          {!isViewer && (
            <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setOpen(false); void onPushCrmNote(story); }} disabled={busy}>Push CRM Note</button>
          )}
          <button type="button" role="menuitem" className="story-library__overflow-item" onClick={() => { setOpen(false); onOpenComments(story); }} disabled={bulkBusy}>Comments</button>
          {!isViewer && (
            <>
              <div className="story-library__overflow-divider" />
              <button type="button" role="menuitem" className="story-library__overflow-item story-library__overflow-item--danger" onClick={() => { setOpen(false); void onDelete(story); }} disabled={busy || !!story.landing_page} title={story.landing_page ? "Delete page first to remove this story" : "Delete story"}>Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function StoryTable({
  stories,
  selectedStoryIds,
  busyStoryId,
  bulkBusy,
  isViewer,
  onToggleSelection,
  onShare,
  onCopy,
  onCreateOrEditPage,
  onExport,
  onCopyCrmNote,
  onPushCrmNote,
  onOpenComments,
  onDelete,
}: StoryTableProps) {
  return (
    <div className="table-container">
      <table className="data-table" aria-label="Story library">
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
          {stories.map((story) => {
            const busy = busyStoryId === story.id || bulkBusy;
            return (
              <tr key={story.id}>
                <td className="story-library__select-col">
                  <input
                    type="checkbox"
                    checked={selectedStoryIds.includes(story.id)}
                    onChange={() => onToggleSelection(story.id)}
                    aria-label={`Select story ${story.title}`}
                  />
                </td>
                <td><strong>{story.title}</strong></td>
                <td><Link to={`/accounts/${story.account.id}`}>{story.account.name}</Link></td>
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
                    <button type="button" className="btn btn--sm btn--primary" onClick={() => void onShare(story)} disabled={busy}>Share</button>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopy(story)} disabled={busy}>Copy</button>
                    {!isViewer && (
                      <button type="button" className="btn btn--sm btn--secondary" onClick={() => void onCreateOrEditPage(story)} disabled={busy}>
                        {story.landing_page ? "Edit Page" : "Create Page"}
                      </button>
                    )}
                    <RowOverflow
                      story={story}
                      busy={busy}
                      bulkBusy={bulkBusy}
                      isViewer={isViewer}
                      onExport={onExport}
                      onCopyCrmNote={onCopyCrmNote}
                      onPushCrmNote={onPushCrmNote}
                      onOpenComments={onOpenComments}
                      onDelete={onDelete}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
