import type { Dispatch, SetStateAction } from "react";
import { STORY_TYPE_LABELS } from "../../types/taxonomy";
import type { StoryLibraryItem } from "../../lib/api";

export interface StoryFiltersProps {
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  storyType: string;
  setStoryType: Dispatch<SetStateAction<string>>;
  status: "ALL" | StoryLibraryItem["story_status"];
  setStatus: Dispatch<SetStateAction<"ALL" | StoryLibraryItem["story_status"]>>;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  viewMode: "cards" | "table";
  setViewMode: Dispatch<SetStateAction<"cards" | "table">>;
  setPage: Dispatch<SetStateAction<number>>;
  uniqueStoryTypes: string[];
}

export function StoryFilters({
  searchDraft,
  setSearchDraft,
  storyType,
  setStoryType,
  status,
  setStatus,
  pageSize,
  setPageSize,
  viewMode,
  setViewMode,
  setPage,
  uniqueStoryTypes,
}: StoryFiltersProps) {
  return (
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
  );
}
