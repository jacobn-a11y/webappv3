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
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void onShare(story)} disabled={busyStoryId === story.id || bulkBusy}>Share</button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopy(story)} disabled={busyStoryId === story.id || bulkBusy}>Copy</button>
                  {!isViewer && (
                    <button type="button" className="btn btn--sm btn--secondary" onClick={() => void onCreateOrEditPage(story)} disabled={busyStoryId === story.id || bulkBusy}>
                      {story.landing_page ? "Edit Page" : "Create Page"}
                    </button>
                  )}
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onExport(story, "pdf")} disabled={busyStoryId === story.id || bulkBusy}>PDF</button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onExport(story, "docx")} disabled={busyStoryId === story.id || bulkBusy}>DOCX</button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onCopyCrmNote(story)} disabled={busyStoryId === story.id || bulkBusy}>Copy CRM Note</button>
                  {!isViewer && (
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => void onPushCrmNote(story)} disabled={busyStoryId === story.id || bulkBusy}>Push CRM Note</button>
                  )}
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => onOpenComments(story)} disabled={bulkBusy}>Comments</button>
                  {!isViewer && (
                    <button type="button" className="btn btn--sm btn--danger" onClick={() => void onDelete(story)} disabled={busyStoryId === story.id || bulkBusy || !!story.landing_page} title={story.landing_page ? "Delete page first to remove this story" : "Delete story"}>
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
  );
}
