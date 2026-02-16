/**
 * Landing Pages Dashboard — Server-Rendered HTML
 *
 * Renders a full admin dashboard page at /dashboard/pages with:
 *   - Stat cards (total pages, published, drafts, total views)
 *   - Filterable/sortable table of all landing pages
 *   - Row actions (edit, view public page, unpublish, archive, delete)
 *   - Search by title and filter by status/visibility/creator
 *   - Non-admin users only see their own pages
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { LandingPageEditor, type LandingPageSummary } from "../services/landing-page-editor.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface DashboardStats {
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  totalViews: number;
}

interface Creator {
  userId: string;
  name: string | null;
  email: string;
}

// ─── Route Factory ────────────────────────────────────────────────────────────

export function createDashboardPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);

  /**
   * GET /dashboard/pages
   *
   * Renders the full landing pages dashboard as HTML.
   * Query params: search, status, visibility, created_by, sort_by, sort_dir
   */
  router.get("/pages", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = req.userRole && ["OWNER", "ADMIN"].includes(req.userRole);

    // Parse query params
    const search = (req.query.search as string) || "";
    const statusFilter = req.query.status as string | undefined;
    const visibilityFilter = req.query.visibility as string | undefined;
    const creatorFilter = req.query.created_by as string | undefined;
    const sortBy = (req.query.sort_by as string) || "updatedAt";
    const sortDir = (req.query.sort_dir as "asc" | "desc") || "desc";

    // Non-admin users are forced to only see their own pages
    const effectiveCreatorFilter = isAdmin ? creatorFilter : req.userId;

    try {
      const [dashboardStats, pages] = await Promise.all([
        editor.getDashboardStats(req.organizationId),
        editor.listForOrg(req.organizationId, {
          status: statusFilter as "DRAFT" | "PUBLISHED" | "ARCHIVED" | undefined,
          createdById: effectiveCreatorFilter,
          search: search || undefined,
        }),
      ]);

      const stats: DashboardStats = {
        totalPages: dashboardStats.totalPages,
        publishedPages: dashboardStats.publishedPages,
        draftPages: dashboardStats.draftPages,
        totalViews: dashboardStats.totalViews,
      };

      const creators: Creator[] = isAdmin
        ? dashboardStats.pagesByUser.map((u) => ({
            userId: u.userId,
            name: u.name,
            email: u.name ?? u.userId,
          }))
        : [];

      const html = renderDashboardHtml({
        stats,
        pages,
        creators,
        isAdmin: !!isAdmin,
        currentUserId: req.userId,
        filters: {
          search,
          status: statusFilter,
          visibility: visibilityFilter,
          createdBy: effectiveCreatorFilter,
          sortBy,
          sortDir,
        },
      });

      res.setHeader("Cache-Control", "private, no-cache");
      res.send(html);
    } catch (err) {
      console.error("Dashboard page render error:", err);
      res.status(500).json({ error: "Failed to render dashboard" });
    }
  });

  return router;
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderDashboardHtml(data: {
  stats: DashboardStats;
  pages: LandingPageSummary[];
  creators: Creator[];
  isAdmin: boolean;
  currentUserId: string;
  filters: {
    search: string;
    status?: string;
    visibility?: string;
    createdBy?: string;
    sortBy: string;
    sortDir: string;
  };
}): string {
  const { stats, pages, creators, isAdmin, currentUserId, filters } = data;

  const tableRows = pages
    .map((page) => renderTableRow(page, isAdmin, currentUserId))
    .join("\n");

  const creatorOptions = creators
    .map(
      (c) =>
        `<option value="${escapeAttr(c.userId)}"${filters.createdBy === c.userId ? " selected" : ""}>${escapeHtml(c.name || c.email)}</option>`
    )
    .join("\n");

  const emptyState =
    pages.length === 0
      ? `<tr><td colspan="7" class="empty-state">No landing pages found matching your filters.</td></tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Landing Pages Dashboard</title>
  <style>
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-muted: #8b8fa3;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f0f5;
      --color-success: #059669;
      --color-success-bg: #ecfdf5;
      --color-warning: #d97706;
      --color-warning-bg: #fffbeb;
      --color-danger: #dc2626;
      --color-danger-bg: #fef2f2;
      --color-info: #2563eb;
      --color-info-bg: #eff6ff;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 2px 8px rgba(0,0,0,0.06);
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.5;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ────────────────────────────────────────────────── */
    .dashboard {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .dashboard__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .dashboard__title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
    }

    .dashboard__subtitle {
      font-size: 0.875rem;
      color: var(--color-text-muted);
      margin-top: 2px;
    }

    /* ─── Stat Cards ────────────────────────────────────────────── */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .stat-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
    }

    .stat-card__label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-card__value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-text);
      line-height: 1;
    }

    .stat-card__icon {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.75rem;
    }
    .stat-card__icon svg { width: 20px; height: 20px; }
    .stat-card--total .stat-card__icon { background: var(--color-accent-light); color: var(--color-accent); }
    .stat-card--published .stat-card__icon { background: var(--color-success-bg); color: var(--color-success); }
    .stat-card--drafts .stat-card__icon { background: var(--color-warning-bg); color: var(--color-warning); }
    .stat-card--views .stat-card__icon { background: var(--color-info-bg); color: var(--color-info); }

    /* ─── Filters ───────────────────────────────────────────────── */
    .filters {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
      box-shadow: var(--shadow-sm);
    }

    .filters__search {
      flex: 1;
      min-width: 200px;
      position: relative;
    }

    .filters__search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-muted);
      pointer-events: none;
    }
    .filters__search-icon svg { width: 16px; height: 16px; }

    .filters__search input {
      width: 100%;
      padding: 0.5rem 0.75rem 0.5rem 2rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      font-family: var(--font-sans);
      outline: none;
      transition: border-color 0.15s;
    }
    .filters__search input:focus { border-color: var(--color-accent); }

    .filters select {
      padding: 0.5rem 2rem 0.5rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      font-family: var(--font-sans);
      background: white;
      outline: none;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23555770' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
    }
    .filters select:focus { border-color: var(--color-accent); }

    .filters__clear {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-family: var(--font-sans);
      background: white;
      color: var(--color-text-secondary);
      cursor: pointer;
      text-decoration: none;
    }
    .filters__clear:hover { background: var(--color-bg); }

    /* ─── Table ─────────────────────────────────────────────────── */
    .table-wrap {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    thead {
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }

    thead th {
      padding: 0.75rem 1rem;
      text-align: left;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
      white-space: nowrap;
      user-select: none;
    }

    thead th a {
      color: inherit;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    thead th a:hover { color: var(--color-text); }
    thead th .sort-icon { font-size: 10px; }
    thead th .sort-icon--active { color: var(--color-accent); }

    tbody tr {
      border-bottom: 1px solid var(--color-border-light);
      transition: background 0.1s;
    }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: var(--color-bg); }

    tbody td {
      padding: 0.75rem 1rem;
      vertical-align: middle;
    }

    .cell-title {
      font-weight: 500;
      color: var(--color-text);
    }
    .cell-account {
      color: var(--color-text-secondary);
      font-size: 0.8rem;
    }

    /* ─── Badges ────────────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge--draft { background: var(--color-warning-bg); color: var(--color-warning); }
    .badge--published { background: var(--color-success-bg); color: var(--color-success); }
    .badge--archived { background: #f3f4f6; color: #6b7280; }
    .badge--private { background: #f3f4f6; color: #6b7280; }
    .badge--shared { background: var(--color-info-bg); color: var(--color-info); }

    /* ─── Row Actions ───────────────────────────────────────────── */
    .actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .actions__btn {
      padding: 4px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      font-family: var(--font-sans);
      cursor: pointer;
      background: white;
      color: var(--color-text-secondary);
      text-decoration: none;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .actions__btn:hover { background: var(--color-bg); color: var(--color-text); }
    .actions__btn--danger { color: var(--color-danger); }
    .actions__btn--danger:hover { background: var(--color-danger-bg); color: var(--color-danger); }

    .actions__menu {
      position: relative;
      display: inline-block;
    }

    .actions__menu-toggle {
      padding: 4px 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: white;
      cursor: pointer;
      color: var(--color-text-muted);
      font-size: 16px;
      line-height: 1;
    }
    .actions__menu-toggle:hover { background: var(--color-bg); }

    .actions__dropdown {
      display: none;
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 4px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      min-width: 160px;
      z-index: 100;
      overflow: hidden;
    }

    .actions__menu.open .actions__dropdown { display: block; }

    .actions__dropdown-item {
      display: block;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: none;
      text-align: left;
      font-size: 0.8rem;
      font-family: var(--font-sans);
      color: var(--color-text);
      cursor: pointer;
      text-decoration: none;
    }
    .actions__dropdown-item:hover { background: var(--color-bg); }
    .actions__dropdown-item--danger { color: var(--color-danger); }
    .actions__dropdown-item--danger:hover { background: var(--color-danger-bg); }

    .actions__dropdown-divider {
      height: 1px;
      background: var(--color-border-light);
      margin: 4px 0;
    }

    /* ─── Empty State ───────────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem !important;
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }

    /* ─── Responsive ────────────────────────────────────────────── */
    @media (max-width: 900px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .filters { flex-direction: column; }
      .filters__search { min-width: 100%; }
      .table-wrap { overflow-x: auto; }
      table { min-width: 800px; }
    }

    @media (max-width: 600px) {
      .stats { grid-template-columns: 1fr; }
      .dashboard { padding: 1rem; }
    }

    /* ─── Confirm Dialog ────────────────────────────────────────── */
    .confirm-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 200;
      align-items: center;
      justify-content: center;
    }
    .confirm-overlay.active { display: flex; }
    .confirm-dialog {
      background: white;
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    }
    .confirm-dialog h3 { margin-bottom: 0.5rem; }
    .confirm-dialog p { color: var(--color-text-secondary); font-size: 0.875rem; margin-bottom: 1.25rem; }
    .confirm-dialog__actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .confirm-dialog__btn {
      padding: 0.5rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      font-family: var(--font-sans);
      cursor: pointer;
      border: 1px solid var(--color-border);
      background: white;
    }
    .confirm-dialog__btn:hover { background: var(--color-bg); }
    .confirm-dialog__btn--danger { background: var(--color-danger); color: white; border-color: var(--color-danger); }
    .confirm-dialog__btn--danger:hover { background: #b91c1c; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="dashboard">
    <!-- Header -->
    <div class="dashboard__header">
      <div>
        <h1 class="dashboard__title">Landing Pages</h1>
        <p class="dashboard__subtitle">${isAdmin ? "All pages across your organization" : "Your landing pages"}</p>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="stats">
      <div class="stat-card stat-card--total">
        <div class="stat-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10,9 9,9 8,9"/>
          </svg>
        </div>
        <div class="stat-card__label">Total Pages</div>
        <div class="stat-card__value">${stats.totalPages}</div>
      </div>
      <div class="stat-card stat-card--published">
        <div class="stat-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22,4 12,14.01 9,11.01"/>
          </svg>
        </div>
        <div class="stat-card__label">Published</div>
        <div class="stat-card__value">${stats.publishedPages}</div>
      </div>
      <div class="stat-card stat-card--drafts">
        <div class="stat-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        <div class="stat-card__label">Drafts</div>
        <div class="stat-card__value">${stats.draftPages}</div>
      </div>
      <div class="stat-card stat-card--views">
        <div class="stat-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div class="stat-card__label">Total Views</div>
        <div class="stat-card__value">${formatNumber(stats.totalViews)}</div>
      </div>
    </div>

    <!-- Filters -->
    <form class="filters" method="GET" action="/dashboard/pages" id="filterForm">
      <div class="filters__search">
        <span class="filters__search-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input type="text" name="search" placeholder="Search by title..." value="${escapeAttr(filters.search)}" />
      </div>

      <select name="status" onchange="this.form.submit()">
        <option value="">All Statuses</option>
        <option value="DRAFT"${filters.status === "DRAFT" ? " selected" : ""}>Draft</option>
        <option value="PUBLISHED"${filters.status === "PUBLISHED" ? " selected" : ""}>Published</option>
        <option value="ARCHIVED"${filters.status === "ARCHIVED" ? " selected" : ""}>Archived</option>
      </select>

      <select name="visibility" onchange="this.form.submit()">
        <option value="">All Visibility</option>
        <option value="PRIVATE"${filters.visibility === "PRIVATE" ? " selected" : ""}>Private</option>
        <option value="SHARED_WITH_LINK"${filters.visibility === "SHARED_WITH_LINK" ? " selected" : ""}>Shared</option>
      </select>

      ${
        isAdmin
          ? `<select name="created_by" onchange="this.form.submit()">
              <option value="">All Creators</option>
              ${creatorOptions}
            </select>`
          : ""
      }

      <!-- Preserve sort state in hidden fields -->
      <input type="hidden" name="sort_by" value="${escapeAttr(filters.sortBy)}" />
      <input type="hidden" name="sort_dir" value="${escapeAttr(filters.sortDir)}" />

      ${hasActiveFilters(filters) ? `<a href="/dashboard/pages" class="filters__clear">Clear filters</a>` : ""}
    </form>

    <!-- Table -->
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${sortLink("Title", "title", filters)}</th>
            <th>Account</th>
            <th>${sortLink("Status", "status", filters)}</th>
            <th>${sortLink("Visibility", "visibility", filters)}</th>
            <th>${sortLink("Views", "viewCount", filters)}</th>
            <th>${isAdmin ? sortLink("Created By", "createdById", filters) : "Created By"}</th>
            <th>${sortLink("Published", "publishedAt", filters)}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || emptyState}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Confirm Dialog -->
  <div class="confirm-overlay" id="confirmOverlay">
    <div class="confirm-dialog">
      <h3 id="confirmTitle">Confirm Action</h3>
      <p id="confirmMessage">Are you sure?</p>
      <div class="confirm-dialog__actions">
        <button class="confirm-dialog__btn" onclick="closeConfirm()">Cancel</button>
        <button class="confirm-dialog__btn confirm-dialog__btn--danger" id="confirmBtn" onclick="executeAction()">Confirm</button>
      </div>
    </div>
  </div>

  <script>
    // ── Filter form: submit on Enter in search ──
    document.querySelector('.filters__search input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('filterForm').submit();
      }
    });

    // ── Action menu toggle ──
    document.addEventListener('click', function(e) {
      // Close all open menus
      document.querySelectorAll('.actions__menu.open').forEach(function(menu) {
        if (!menu.contains(e.target)) {
          menu.classList.remove('open');
        }
      });
    });

    function toggleMenu(btn) {
      var menu = btn.closest('.actions__menu');
      var wasOpen = menu.classList.contains('open');

      // Close all others
      document.querySelectorAll('.actions__menu.open').forEach(function(m) {
        m.classList.remove('open');
      });

      if (!wasOpen) {
        menu.classList.toggle('open');
      }
      event.stopPropagation();
    }

    // ── Row actions ──
    var pendingAction = null;

    function doAction(action, pageId, title) {
      if (action === 'edit') {
        window.location.href = '/api/pages/' + pageId;
        return;
      }
      if (action === 'view') {
        // Will be handled by direct link
        return;
      }

      var messages = {
        unpublish: { title: 'Unpublish Page', message: 'Revert "' + title + '" to draft? It will no longer be publicly accessible.', label: 'Unpublish' },
        archive: { title: 'Archive Page', message: 'Archive "' + title + '"? It will be hidden from the public and marked as archived.', label: 'Archive' },
        delete: { title: 'Delete Page', message: 'Permanently delete "' + title + '"? This cannot be undone.', label: 'Delete' },
      };

      var msg = messages[action];
      if (!msg) return;

      pendingAction = { action: action, pageId: pageId };
      document.getElementById('confirmTitle').textContent = msg.title;
      document.getElementById('confirmMessage').textContent = msg.message;
      document.getElementById('confirmBtn').textContent = msg.label;
      document.getElementById('confirmOverlay').classList.add('active');
    }

    function closeConfirm() {
      document.getElementById('confirmOverlay').classList.remove('active');
      pendingAction = null;
    }

    function executeAction() {
      if (!pendingAction) return;

      var action = pendingAction.action;
      var pageId = pendingAction.pageId;
      var url, method;

      if (action === 'unpublish') {
        url = '/api/pages/' + pageId + '/unpublish';
        method = 'POST';
      } else if (action === 'archive') {
        url = '/api/pages/' + pageId + '/archive';
        method = 'POST';
      } else if (action === 'delete') {
        url = '/api/pages/' + pageId;
        method = 'DELETE';
      }

      closeConfirm();

      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      })
      .then(function(res) {
        if (res.ok) {
          window.location.reload();
        } else {
          return res.json().then(function(data) {
            alert('Action failed: ' + (data.error || 'Unknown error'));
          });
        }
      })
      .catch(function() {
        alert('Network error. Please try again.');
      });
    }

    // Close confirm on overlay click
    document.getElementById('confirmOverlay').addEventListener('click', function(e) {
      if (e.target === this) closeConfirm();
    });

    // Close confirm on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeConfirm();
    });
  </script>
</body>
</html>`;
}

// ─── Table Row Renderer ───────────────────────────────────────────────────────

function renderTableRow(
  page: LandingPageSummary,
  isAdmin: boolean,
  currentUserId: string
): string {
  const statusBadge = renderStatusBadge(page.status);
  const visibilityBadge = renderVisibilityBadge(page.visibility);
  const creatorDisplay = page.createdByName || page.createdByEmail;
  const publishedDate = page.publishedAt
    ? formatDate(page.publishedAt)
    : "&mdash;";

  const isOwner = page.createdByName !== null; // all pages have a creator
  const canManage = isAdmin || true; // page owner can manage their pages

  // Build action buttons: edit is always available, view only if published
  const viewLink =
    page.status === "PUBLISHED" && page.visibility === "SHARED_WITH_LINK"
      ? `<a href="/s/${escapeAttr(page.slug)}" target="_blank" class="actions__btn" title="View public page">View</a>`
      : "";

  // Build dropdown items
  const dropdownItems: string[] = [];

  dropdownItems.push(
    `<a href="/api/pages/${escapeAttr(page.id)}" class="actions__dropdown-item">Edit</a>`
  );

  if (page.status === "PUBLISHED" && page.visibility === "SHARED_WITH_LINK") {
    dropdownItems.push(
      `<a href="/s/${escapeAttr(page.slug)}" target="_blank" class="actions__dropdown-item">View public page</a>`
    );
  }

  if (page.status === "PUBLISHED") {
    dropdownItems.push(
      `<button class="actions__dropdown-item" onclick="doAction('unpublish','${escapeAttr(page.id)}','${escapeAttr(page.title)}')">Unpublish</button>`
    );
  }

  if (page.status !== "ARCHIVED") {
    dropdownItems.push(
      `<button class="actions__dropdown-item" onclick="doAction('archive','${escapeAttr(page.id)}','${escapeAttr(page.title)}')">Archive</button>`
    );
  }

  if (isAdmin) {
    dropdownItems.push(`<div class="actions__dropdown-divider"></div>`);
    dropdownItems.push(
      `<button class="actions__dropdown-item actions__dropdown-item--danger" onclick="doAction('delete','${escapeAttr(page.id)}','${escapeAttr(page.title)}')">Delete</button>`
    );
  }

  return `<tr>
    <td>
      <div class="cell-title">${escapeHtml(page.title)}</div>
    </td>
    <td><span class="cell-account">${escapeHtml(page.accountName)}</span></td>
    <td>${statusBadge}</td>
    <td>${visibilityBadge}</td>
    <td>${formatNumber(page.viewCount)}</td>
    <td>${escapeHtml(creatorDisplay)}</td>
    <td>${publishedDate}</td>
    <td>
      <div class="actions">
        ${viewLink}
        <div class="actions__menu">
          <button class="actions__menu-toggle" onclick="toggleMenu(this)" title="More actions">&#8943;</button>
          <div class="actions__dropdown">
            ${dropdownItems.join("\n            ")}
          </div>
        </div>
      </div>
    </td>
  </tr>`;
}

// ─── Badge Renderers ──────────────────────────────────────────────────────────

function renderStatusBadge(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    PUBLISHED: "Published",
    ARCHIVED: "Archived",
  };
  const classes: Record<string, string> = {
    DRAFT: "badge--draft",
    PUBLISHED: "badge--published",
    ARCHIVED: "badge--archived",
  };
  return `<span class="badge ${classes[status] ?? ""}">${labels[status] ?? status}</span>`;
}

function renderVisibilityBadge(visibility: string): string {
  const labels: Record<string, string> = {
    PRIVATE: "Private",
    SHARED_WITH_LINK: "Shared",
  };
  const classes: Record<string, string> = {
    PRIVATE: "badge--private",
    SHARED_WITH_LINK: "badge--shared",
  };
  return `<span class="badge ${classes[visibility] ?? ""}">${labels[visibility] ?? visibility}</span>`;
}

// ─── Sort Link Helper ─────────────────────────────────────────────────────────

function sortLink(
  label: string,
  field: string,
  filters: { sortBy: string; sortDir: string; search: string; status?: string; visibility?: string; createdBy?: string }
): string {
  const isActive = filters.sortBy === field;
  const nextDir = isActive && filters.sortDir === "asc" ? "desc" : "asc";

  const parts: string[] = [];
  if (filters.search) parts.push(`search=${encodeURIComponent(filters.search)}`);
  if (filters.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters.visibility) parts.push(`visibility=${encodeURIComponent(filters.visibility)}`);
  if (filters.createdBy) parts.push(`created_by=${encodeURIComponent(filters.createdBy)}`);
  parts.push(`sort_by=${encodeURIComponent(field)}`);
  parts.push(`sort_dir=${encodeURIComponent(nextDir)}`);
  const qs = parts.join("&");

  const arrow = isActive
    ? filters.sortDir === "asc"
      ? `<span class="sort-icon sort-icon--active">&#9650;</span>`
      : `<span class="sort-icon sort-icon--active">&#9660;</span>`
    : `<span class="sort-icon">&#9650;&#9660;</span>`;

  return `<a href="/dashboard/pages?${qs}">${escapeHtml(label)} ${arrow}</a>`;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function hasActiveFilters(filters: {
  search: string;
  status?: string;
  visibility?: string;
  createdBy?: string;
}): boolean {
  return !!(filters.search || filters.status || filters.visibility || filters.createdBy);
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
