import type { Dispatch, SetStateAction } from "react";
import { FUNNEL_STAGE_LABELS, STORY_TYPE_LABELS, TOPIC_LABELS } from "../../types/taxonomy";
import type { StoryLibraryItem } from "../../lib/api";

export interface StoryFiltersProps {
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  searchMode: "keyword" | "semantic";
  setSearchMode: Dispatch<SetStateAction<"keyword" | "semantic">>;
  storyType: string;
  setStoryType: Dispatch<SetStateAction<string>>;
  status: "ALL" | StoryLibraryItem["story_status"];
  setStatus: Dispatch<SetStateAction<"ALL" | StoryLibraryItem["story_status"]>>;
  funnelStage: string;
  setFunnelStage: Dispatch<SetStateAction<string>>;
  topic: string;
  setTopic: Dispatch<SetStateAction<string>>;
  availableFunnelStages: string[];
  availableTopics: string[];
  funnelStageCounts: Record<string, number>;
  topicCounts: Record<string, number>;
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
  searchMode,
  setSearchMode,
  storyType,
  setStoryType,
  status,
  setStatus,
  funnelStage,
  setFunnelStage,
  topic,
  setTopic,
  availableFunnelStages,
  availableTopics,
  funnelStageCounts,
  topicCounts,
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
        value={searchMode}
        onChange={(event) => {
          setSearchMode(event.target.value as "keyword" | "semantic");
          setPage(1);
        }}
        aria-label="Search mode"
      >
        <option value="keyword">Keyword Search</option>
        <option value="semantic">Semantic Search</option>
      </select>
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
        <option value="IN_REVIEW">In Review</option>
        <option value="APPROVED">Approved</option>
        <option value="PUBLISHED">Published</option>
      </select>
      <select
        className="form-field__input"
        value={funnelStage}
        onChange={(e) => {
          const nextStage = e.target.value;
          setFunnelStage(nextStage);
          setTopic("ALL");
          setPage(1);
        }}
        aria-label="Filter funnel stage"
      >
        <option value="ALL">All Funnel Stages</option>
        {availableFunnelStages.map((stage) => (
          <option key={stage} value={stage}>
            {FUNNEL_STAGE_LABELS[stage as keyof typeof FUNNEL_STAGE_LABELS] ?? stage}
            {typeof funnelStageCounts[stage] === "number" ? ` (${funnelStageCounts[stage]})` : ""}
          </option>
        ))}
      </select>
      <select
        className="form-field__input"
        value={topic}
        onChange={(e) => {
          setTopic(e.target.value);
          setPage(1);
        }}
        aria-label="Filter taxonomy topic"
      >
        <option value="ALL">All Topics</option>
        {availableTopics.map((topicKey) => (
          <option key={topicKey} value={topicKey}>
            {TOPIC_LABELS[topicKey as keyof typeof TOPIC_LABELS] ?? topicKey}
            {typeof topicCounts[topicKey] === "number" ? ` (${topicCounts[topicKey]})` : ""}
          </option>
        ))}
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
