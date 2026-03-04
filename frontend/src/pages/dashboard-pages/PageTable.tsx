/**
 * PageTable — Sortable table of landing pages with row actions
 * (edit, view, unpublish, archive, delete) and inline action menus.
 */

import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { DashboardPageSummary } from "../../lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SortField =
  | "title"
  | "status"
  | "visibility"
  | "viewCount"
  | "createdById"
  | "publishedAt"
  | "updatedAt";

export type SortDir = "asc" | "desc";

export interface PageTableProps {
  filteredPages: DashboardPageSummary[];
  isAdmin: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  hasActiveFilters: string | boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onSort: (field: SortField) => void;
  onClearFilters: () => void;
  onAction: (action: "unpublish" | "archive" | "delete", page: DashboardPageSummary) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function renderStatusBadge(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    IN_REVIEW: "In Review",
    APPROVED: "Approved",
    PUBLISHED: "Published",
  };
  const classes: Record<string, string> = {
    DRAFT: "dash-pages__badge--draft",
    IN_REVIEW: "dash-pages__badge--warning",
    APPROVED: "dash-pages__badge--success",
    PUBLISHED: "dash-pages__badge--published",
  };
  return (
    <span className={`dash-pages__badge ${classes[status] || ""}`}>
      {labels[status] || status}
    </span>
  );
}

function renderVisibilityBadge(visibility: string) {
  const labels: Record<string, string> = {
    PRIVATE: "Private",
    SHARED_WITH_LINK: "Shared",
  };
  const classes: Record<string, string> = {
    PRIVATE: "dash-pages__badge--private",
    SHARED_WITH_LINK: "dash-pages__badge--shared",
  };
  return (
    <span className={`dash-pages__badge ${classes[visibility] || ""}`}>
      {labels[visibility] || visibility}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PageTable({
  filteredPages,
  isAdmin,
  sortBy,
  sortDir,
  hasActiveFilters,
  openMenuId,
  setOpenMenuId,
  onSort,
  onClearFilters,
  onAction,
}: PageTableProps) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Sort arrow renderer
  const renderSortArrow = (field: SortField) => {
    const isActive = sortBy === field;
    if (isActive) {
      return (
        <span className="dash-pages__sort-icon dash-pages__sort-icon--active">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {sortDir === "asc"
              ? <path d="M3 8l3-4 3 4" />
              : <path d="M3 4l3 4 3-4" />}
          </svg>
        </span>
      );
    }
    return (
      <span className="dash-pages__sort-icon">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 4.5l3-3 3 3" /><path d="M3 7.5l3 3 3-3" />
        </svg>
      </span>
    );
  };

  return (
    <div className="dash-pages__table-wrap">
      <table className="dash-pages__table">
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="dash-pages__sort-btn"
                onClick={() => onSort("title")}
              >
                Title {renderSortArrow("title")}
              </button>
            </th>
            <th>Account</th>
            <th>
              <button
                type="button"
                className="dash-pages__sort-btn"
                onClick={() => onSort("status")}
              >
                Status {renderSortArrow("status")}
              </button>
            </th>
            <th>
              <button
                type="button"
                className="dash-pages__sort-btn"
                onClick={() => onSort("visibility")}
              >
                Visibility {renderSortArrow("visibility")}
              </button>
            </th>
            <th>
              <button
                type="button"
                className="dash-pages__sort-btn"
                onClick={() => onSort("viewCount")}
              >
                Views {renderSortArrow("viewCount")}
              </button>
            </th>
            <th>
              {isAdmin ? (
                <button
                  type="button"
                  className="dash-pages__sort-btn"
                  onClick={() => onSort("createdById")}
                >
                  Created By {renderSortArrow("createdById")}
                </button>
              ) : (
                "Created By"
              )}
            </th>
            <th>
              <button
                type="button"
                className="dash-pages__sort-btn"
                onClick={() => onSort("publishedAt")}
              >
                Published {renderSortArrow("publishedAt")}
              </button>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredPages.length === 0 ? (
            <tr>
              <td colSpan={8} className="dash-pages__empty-state">
                <div className="dash-pages__empty-content">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span className="dash-pages__empty-title">
                    {hasActiveFilters ? "No pages match your filters" : "No landing pages yet"}
                  </span>
                  <span className="dash-pages__empty-subtitle">
                    {hasActiveFilters
                      ? "Try adjusting your search or filter criteria."
                      : "Create your first landing page to get started."}
                  </span>
                  {hasActiveFilters && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={onClearFilters}>
                      Clear all filters
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            filteredPages.map((page) => (
              <tr key={page.id}>
                <td>
                  <div className="dash-pages__cell-title">{page.title}</div>
                </td>
                <td>
                  <span className="dash-pages__cell-account">
                    {page.accountName}
                  </span>
                </td>
                <td>{renderStatusBadge(page.lifecycleStage)}</td>
                <td>{renderVisibilityBadge(page.visibility)}</td>
                <td>{formatNumber(page.viewCount)}</td>
                <td>{page.createdByName || page.createdByEmail}</td>
                <td>
                  {page.publishedAt ? formatDate(page.publishedAt) : "\u2014"}
                </td>
                <td>
                  <div className="dash-pages__actions">
                    {page.status === "PUBLISHED" &&
                      page.visibility === "SHARED_WITH_LINK" && (
                        <a
                          href={`/s/${page.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="dash-pages__action-btn"
                          title="View public page"
                        >
                          View
                        </a>
                      )}
                    <div
                      className={`dash-pages__action-menu ${
                        openMenuId === page.id
                          ? "dash-pages__action-menu--open"
                          : ""
                      }`}
                      ref={openMenuId === page.id ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        className="dash-pages__menu-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(
                            openMenuId === page.id ? null : page.id
                          );
                        }}
                        aria-label={`More actions for ${page.title}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === page.id}
                      >
                        &#8943;
                      </button>
                      {openMenuId === page.id && (
                        <div className="dash-pages__dropdown">
                          <button
                            type="button"
                            className="dash-pages__dropdown-item"
                            onClick={() => {
                              setOpenMenuId(null);
                              navigate(`/pages/${page.id}/edit`);
                            }}
                          >
                            Edit
                          </button>
                          {page.status === "PUBLISHED" &&
                            page.visibility === "SHARED_WITH_LINK" && (
                              <a
                                href={`/s/${page.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="dash-pages__dropdown-item"
                                onClick={() => setOpenMenuId(null)}
                              >
                                View public page
                              </a>
                            )}
                          {page.status === "PUBLISHED" && (
                            <button
                              type="button"
                              className="dash-pages__dropdown-item"
                              onClick={() => onAction("unpublish", page)}
                            >
                              Unpublish
                            </button>
                          )}
                          {page.status !== "ARCHIVED" && (
                            <button
                              type="button"
                              className="dash-pages__dropdown-item"
                              onClick={() => onAction("archive", page)}
                            >
                              Archive
                            </button>
                          )}
                          {isAdmin && (
                            <>
                              <div className="dash-pages__dropdown-divider" />
                              <button
                                type="button"
                                className="dash-pages__dropdown-item dash-pages__dropdown-item--danger"
                                onClick={() => onAction("delete", page)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
