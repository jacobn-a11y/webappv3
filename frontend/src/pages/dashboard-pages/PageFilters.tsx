/**
 * PageFilters — Search input, status/visibility/creator dropdowns,
 * and a clear-filters button for the Dashboard Pages page.
 */

import type { Dispatch, SetStateAction } from "react";
import type { DashboardCreator } from "../../lib/api";

export interface PageFiltersProps {
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: Dispatch<SetStateAction<string>>;
  visibilityFilter: string;
  setVisibilityFilter: Dispatch<SetStateAction<string>>;
  creatorFilter: string;
  setCreatorFilter: Dispatch<SetStateAction<string>>;
  isAdmin: boolean;
  creators: DashboardCreator[];
  hasActiveFilters: string | boolean;
  onClearFilters: () => void;
}

export function PageFilters({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  visibilityFilter,
  setVisibilityFilter,
  creatorFilter,
  setCreatorFilter,
  isAdmin,
  creators,
  hasActiveFilters,
  onClearFilters,
}: PageFiltersProps) {
  return (
    <div className="dash-pages__filters">
      <div className="dash-pages__search">
        <span className="dash-pages__search-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="text"
          className="dash-pages__search-input"
          placeholder="Search by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search landing pages by title"
        />
      </div>

      <select
        className="dash-pages__select"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        aria-label="Filter by status"
      >
        <option value="">All Statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="IN_REVIEW">In Review</option>
        <option value="APPROVED">Approved</option>
        <option value="PUBLISHED">Published</option>
      </select>

      <select
        className="dash-pages__select"
        value={visibilityFilter}
        onChange={(e) => setVisibilityFilter(e.target.value)}
        aria-label="Filter by visibility"
      >
        <option value="">All Visibility</option>
        <option value="PRIVATE">Private</option>
        <option value="SHARED_WITH_LINK">Shared</option>
      </select>

      {isAdmin && creators.length > 0 && (
        <select
          className="dash-pages__select"
          value={creatorFilter}
          onChange={(e) => setCreatorFilter(e.target.value)}
          aria-label="Filter by creator"
        >
          <option value="">All Creators</option>
          {creators.map((c) => (
            <option key={c.userId} value={c.email}>
              {c.name || c.email}
            </option>
          ))}
        </select>
      )}

      {hasActiveFilters && (
        <button
          type="button"
          className="dash-pages__clear-btn"
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
