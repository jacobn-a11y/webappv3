/**
 * Shared action buttons for a story item.
 *
 * Used in both the card grid and bulk table views of StoryLibraryPage
 * to eliminate the duplicated button sets.
 */
import type { StoryLibraryItem } from "../lib/api";

export interface StoryActionCallbacks {
  onShare: (story: StoryLibraryItem) => void;
  onCopyMarkdown: (story: StoryLibraryItem) => void;
  onCreateOrEditPage: (story: StoryLibraryItem) => void;
  onExport: (story: StoryLibraryItem, format: "pdf" | "docx") => void;
  onCopyCrmNote: (story: StoryLibraryItem) => void;
  onPushCrmNote: (story: StoryLibraryItem) => void;
  onOpenComments: (story: StoryLibraryItem) => void;
  onDelete?: (story: StoryLibraryItem) => void;
}

interface StoryActionButtonsProps {
  story: StoryLibraryItem;
  callbacks: StoryActionCallbacks;
  busy: boolean;
  isViewer: boolean;
}

export function StoryActionButtons({
  story,
  callbacks,
  busy,
  isViewer,
}: StoryActionButtonsProps) {
  return (
    <>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        onClick={() => callbacks.onShare(story)}
        disabled={busy}
      >
        Share
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => callbacks.onCopyMarkdown(story)}
        disabled={busy}
      >
        Copy
      </button>
      {!isViewer && (
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={() => callbacks.onCreateOrEditPage(story)}
          disabled={busy}
        >
          {story.landing_page ? "Edit Page" : "Create Page"}
        </button>
      )}
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => callbacks.onExport(story, "pdf")}
        disabled={busy}
      >
        PDF
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => callbacks.onExport(story, "docx")}
        disabled={busy}
      >
        DOCX
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => callbacks.onCopyCrmNote(story)}
        disabled={busy}
      >
        Copy CRM Note
      </button>
      {!isViewer && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => callbacks.onPushCrmNote(story)}
          disabled={busy}
        >
          Push CRM Note
        </button>
      )}
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => callbacks.onOpenComments(story)}
        disabled={busy}
      >
        Comments
      </button>
    </>
  );
}
