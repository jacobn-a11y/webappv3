/**
 * Dashboard Pages
 *
 * Admin/user dashboard for managing landing pages with:
 *   - 4 stat cards (Total Pages, Published, Drafts, Total Views)
 *   - Filter bar with search, status/visibility/creator dropdowns, sort columns
 *   - Table of landing pages with row actions
 *   - Confirm dialog for destructive actions (unpublish, archive, delete)
 *   - Client-side filtering and sorting
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getDashboardPagesData,
  unpublishPage,
  archivePage,
  deletePage,
  type DashboardStats,
  type DashboardPageSummary,
  type DashboardCreator,
} from "../lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type SortField =
  | "title"
  | "status"
  | "visibility"
  | "viewCount"
  | "createdById"
  | "publishedAt"
  | "updatedAt";

type SortDir = "asc" | "desc";

interface ConfirmAction {
  action: "unpublish" | "archive" | "delete";
  pageId: string;
  pageTitle: string;
}

const CONFIRM_MESSAGES: Record<
  string,
  { title: string; message: (name: string) => string; label: string }
> = {
  unpublish: {
    title: "Unpublish Page",
    message: (name) =>
      `Revert "${name}" to draft? It will no longer be publicly accessible.`,
    label: "Unpublish",
  },
  archive: {
    title: "Archive Page",
    message: (name) =>
      `Archive "${name}"? It will be hidden from the public and marked as archived.`,
    label: "Archive",
  },
  delete: {
    title: "Delete Page",
    message: (name) =>
      `Permanently delete "${name}"? This cannot be undone.`,
    label: "Delete",
  },
};

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

// ─── Main Component ──────────────────────────────────────────────────────────

export function DashboardPagesPage() {
  const navigate = useNavigate();

  // Data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalPages: 0,
    publishedPages: 0,
    draftPages: 0,
    totalViews: 0,
  });
  const [pages, setPages] = useState<DashboardPageSummary[]>([]);
  const [creators, setCreators] = useState<DashboardCreator[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Filter state (client-side)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Inline error state (replaces native alert)
  const [actionError, setActionError] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboardPagesData();
      setStats(data.stats);
      setPages(data.pages);
      setCreators(data.creators);
      setIsAdmin(data.isAdmin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (openMenuId && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openMenuId]);

  // Close confirm on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmAction(null);
        setOpenMenuId(null);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  // Client-side filtering and sorting
  const filteredPages = useMemo(() => {
    let result = [...pages];

    // Search by title
    if (search.trim()) {
      const lowerSearch = search.toLowerCase();
      result = result.filter((p) =>
        p.title.toLowerCase().includes(lowerSearch)
      );
    }

    // Status filter
    if (statusFilter) {
      result = result.filter((p) => p.status === statusFilter);
    }

    // Visibility filter
    if (visibilityFilter) {
      result = result.filter((p) => p.visibility === visibilityFilter);
    }

    // Creator filter
    if (creatorFilter) {
      result = result.filter((p) => p.createdByEmail === creatorFilter);
    }

    // Sorting
    result.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortBy) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "visibility":
          aVal = a.visibility;
          bVal = b.visibility;
          break;
        case "viewCount":
          aVal = a.viewCount;
          bVal = b.viewCount;
          break;
        case "createdById":
          aVal = (a.createdByName || a.createdByEmail).toLowerCase();
          bVal = (b.createdByName || b.createdByEmail).toLowerCase();
          break;
        case "publishedAt":
          aVal = a.publishedAt || "";
          bVal = b.publishedAt || "";
          break;
        case "updatedAt":
        default:
          aVal = a.updatedAt;
          bVal = b.updatedAt;
          break;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [pages, search, statusFilter, visibilityFilter, creatorFilter, sortBy, sortDir]);

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setVisibilityFilter("");
    setCreatorFilter("");
    setSortBy("updatedAt");
    setSortDir("desc");
  };

  const hasActiveFilters =
    search || statusFilter || visibilityFilter || creatorFilter;

  // Row actions
  const handleAction = (action: ConfirmAction["action"], page: DashboardPageSummary) => {
    setOpenMenuId(null);

    if (action === "unpublish" || action === "archive" || action === "delete") {
      setConfirmAction({ action, pageId: page.id, pageTitle: page.title });
    }
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);

    try {
      switch (confirmAction.action) {
        case "unpublish":
          await unpublishPage(confirmAction.pageId);
          break;
        case "archive":
          await archivePage(confirmAction.pageId);
          break;
        case "delete":
          await deletePage(confirmAction.pageId);
          break;
      }
      setConfirmAction(null);
      setActionError(null);
      // Reload data after action
      await loadData();
    } catch (err) {
      setConfirmAction(null);
      setActionError(
        "Action failed: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Sort arrow renderer
  const renderSortArrow = (field: SortField) => {
    const isActive = sortBy === field;
    if (isActive) {
      return (
        <span className="dash-pages__sort-icon dash-pages__sort-icon--active">
          {sortDir === "asc" ? "\u25B2" : "\u25BC"}
        </span>
      );
    }
    return (
      <span className="dash-pages__sort-icon">{"\u25B2\u25BC"}</span>
    );
  };

  // Status badge
  const renderStatusBadge = (status: string) => {
    const labels: Record<string, string> = {
      DRAFT: "Draft",
      PUBLISHED: "Published",
      ARCHIVED: "Archived",
    };
    const classes: Record<string, string> = {
      DRAFT: "dash-pages__badge--draft",
      PUBLISHED: "dash-pages__badge--published",
      ARCHIVED: "dash-pages__badge--archived",
    };
    return (
      <span className={`dash-pages__badge ${classes[status] || ""}`}>
        {labels[status] || status}
      </span>
    );
  };

  // Visibility badge
  const renderVisibilityBadge = (visibility: string) => {
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
  };

  // ─── Loading State ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="dash-pages__loading" role="status" aria-live="polite">
        <div className="dash-pages__spinner" aria-hidden="true" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-pages__error" role="alert">
        <h2>Failed to load dashboard</h2>
        <p>{error}</p>
        <button
          type="button"
          className="dash-pages__btn dash-pages__btn--primary"
          onClick={loadData}
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dash-pages">
      {/* Header */}
      <div className="dash-pages__header">
        <div>
          <h1 className="dash-pages__title">Landing Pages</h1>
          <p className="dash-pages__subtitle">
            {isAdmin
              ? "All pages across your organization"
              : "Your landing pages"}
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="dash-pages__stats">
        <div className="dash-pages__stat-card dash-pages__stat-card--total">
          <div className="dash-pages__stat-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10,9 9,9 8,9" />
            </svg>
          </div>
          <div className="dash-pages__stat-label">Total Pages</div>
          <div className="dash-pages__stat-value">{stats.totalPages}</div>
        </div>

        <div className="dash-pages__stat-card dash-pages__stat-card--published">
          <div className="dash-pages__stat-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22,4 12,14.01 9,11.01" />
            </svg>
          </div>
          <div className="dash-pages__stat-label">Published</div>
          <div className="dash-pages__stat-value">{stats.publishedPages}</div>
        </div>

        <div className="dash-pages__stat-card dash-pages__stat-card--drafts">
          <div className="dash-pages__stat-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <div className="dash-pages__stat-label">Drafts</div>
          <div className="dash-pages__stat-value">{stats.draftPages}</div>
        </div>

        <div className="dash-pages__stat-card dash-pages__stat-card--views">
          <div className="dash-pages__stat-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="dash-pages__stat-label">Total Views</div>
          <div className="dash-pages__stat-value">
            {formatNumber(stats.totalViews)}
          </div>
        </div>
      </div>

      {/* Filters */}
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
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
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
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Accessible result count announcement */}
      <div className="sr-only" aria-live="polite" role="status">
        {hasActiveFilters
          ? `${filteredPages.length} page${filteredPages.length !== 1 ? "s" : ""} found`
          : ""}
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="dash-pages__action-error" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="dash-pages__action-error-dismiss"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Table */}
      <div className="dash-pages__table-wrap">
        <table className="dash-pages__table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="dash-pages__sort-btn"
                  onClick={() => handleSort("title")}
                >
                  Title {renderSortArrow("title")}
                </button>
              </th>
              <th>Account</th>
              <th>
                <button
                  type="button"
                  className="dash-pages__sort-btn"
                  onClick={() => handleSort("status")}
                >
                  Status {renderSortArrow("status")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="dash-pages__sort-btn"
                  onClick={() => handleSort("visibility")}
                >
                  Visibility {renderSortArrow("visibility")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="dash-pages__sort-btn"
                  onClick={() => handleSort("viewCount")}
                >
                  Views {renderSortArrow("viewCount")}
                </button>
              </th>
              <th>
                {isAdmin ? (
                  <button
                    type="button"
                    className="dash-pages__sort-btn"
                    onClick={() => handleSort("createdById")}
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
                  onClick={() => handleSort("publishedAt")}
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
                  No landing pages found matching your filters.
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
                  <td>{renderStatusBadge(page.status)}</td>
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
                                onClick={() => handleAction("unpublish", page)}
                              >
                                Unpublish
                              </button>
                            )}
                            {page.status !== "ARCHIVED" && (
                              <button
                                type="button"
                                className="dash-pages__dropdown-item"
                                onClick={() => handleAction("archive", page)}
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
                                  onClick={() => handleAction("delete", page)}
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

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={CONFIRM_MESSAGES[confirmAction.action].title}
          message={CONFIRM_MESSAGES[confirmAction.action].message(
            confirmAction.pageTitle
          )}
          confirmLabel={CONFIRM_MESSAGES[confirmAction.action].label}
          loading={actionLoading}
          onConfirm={executeAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Capture previous focus, auto-focus cancel button, and trap focus
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onCancel]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onCancel();
  };

  return (
    <div
      className="dash-pages__confirm-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div
        className="dash-pages__confirm-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <h3 id="confirm-title">{title}</h3>
        <p id="confirm-message">{message}</p>
        <div className="dash-pages__confirm-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="dash-pages__confirm-btn"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dash-pages__confirm-btn dash-pages__confirm-btn--danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
