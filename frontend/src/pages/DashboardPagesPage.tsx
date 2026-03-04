/**
 * Dashboard Pages — Layout shell + data fetching.
 * Sub-components decomposed into ./dashboard-pages/
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
import { PageStatsCards } from "./dashboard-pages/PageStatsCards";
import { PageFilters } from "./dashboard-pages/PageFilters";
import { PageTable, type SortField, type SortDir } from "./dashboard-pages/PageTable";

// Re-export sub-components for backward compatibility
export { PageStatsCards } from "./dashboard-pages/PageStatsCards";
export { PageFilters } from "./dashboard-pages/PageFilters";
export { PageTable } from "./dashboard-pages/PageTable";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Main Component ──────────────────────────────────────────────────────────

export function DashboardPagesPage({ userRole }: { userRole?: string }) {
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
    const handleClick = () => {
      if (openMenuId) setOpenMenuId(null);
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

    if (search.trim()) {
      const lowerSearch = search.toLowerCase();
      result = result.filter((p) => p.title.toLowerCase().includes(lowerSearch));
    }
    if (statusFilter) {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (visibilityFilter) {
      result = result.filter((p) => p.visibility === visibilityFilter);
    }
    if (creatorFilter) {
      result = result.filter((p) => p.createdByEmail === creatorFilter);
    }

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
        {userRole !== "VIEWER" && (
          <button
            className="btn btn--primary"
            onClick={() => navigate("/accounts")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Create New Page
          </button>
        )}
      </div>

      <PageStatsCards stats={stats} />

      <PageFilters
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        visibilityFilter={visibilityFilter}
        setVisibilityFilter={setVisibilityFilter}
        creatorFilter={creatorFilter}
        setCreatorFilter={setCreatorFilter}
        isAdmin={isAdmin}
        creators={creators}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

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

      <PageTable
        filteredPages={filteredPages}
        isAdmin={isAdmin}
        sortBy={sortBy}
        sortDir={sortDir}
        hasActiveFilters={hasActiveFilters}
        openMenuId={openMenuId}
        setOpenMenuId={setOpenMenuId}
        onSort={handleSort}
        onClearFilters={clearFilters}
        onAction={handleAction}
      />

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
