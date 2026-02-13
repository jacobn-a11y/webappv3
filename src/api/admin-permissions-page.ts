/**
 * Admin Permissions Page
 *
 * Server-rendered HTML page for managing org user permissions.
 * Displays a table of all org users with toggle switches for each permission.
 * OWNER/ADMIN roles show all toggles as permanently on (greyed out).
 * Member rows are expandable to show account access grants.
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { PermissionManager, requirePermission } from "../middleware/permissions.js";
import { AccountAccessService } from "../services/account-access.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

/** The permission columns displayed in the table. */
const PERMISSION_COLUMNS: ReadonlyArray<{
  key: string;
  label: string;
  short: string;
  adminOnly?: boolean;
}> = [
  { key: "CREATE_LANDING_PAGE", label: "Create", short: "CREATE" },
  { key: "PUBLISH_LANDING_PAGE", label: "Publish", short: "PUBLISH" },
  { key: "PUBLISH_NAMED_LANDING_PAGE", label: "Publish Named", short: "PUB_NAMED", adminOnly: true },
  { key: "EDIT_ANY_LANDING_PAGE", label: "Edit Any", short: "EDIT_ANY" },
  { key: "DELETE_ANY_LANDING_PAGE", label: "Delete Any", short: "DELETE_ANY" },
  { key: "VIEW_ANALYTICS", label: "Analytics", short: "ANALYTICS" },
];

const ADMIN_ROLES: UserRole[] = ["OWNER", "ADMIN"];

// ─── Route Factory ────────────────────────────────────────────────────────────

export function createAdminPermissionsPage(prisma: PrismaClient): Router {
  const router = Router();
  const permManager = new PermissionManager(prisma);
  const accessService = new AccountAccessService(prisma);

  /**
   * GET /admin/permissions
   *
   * Renders the full permissions management page as server-side HTML.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const matrix = await permManager.getOrgPermissionMatrix(req.organizationId);

        // For each MEMBER/VIEWER, pre-fetch account access grants
        const accessByUser: Record<string, Awaited<ReturnType<typeof accessService.listUserAccess>>> = {};
        for (const user of matrix) {
          if (!ADMIN_ROLES.includes(user.role)) {
            accessByUser[user.userId] = await accessService.listUserAccess(
              user.userId,
              req.organizationId
            );
          }
        }

        res.setHeader("Cache-Control", "private, no-cache");
        res.send(renderPermissionsPage(matrix, accessByUser));
      } catch (err) {
        console.error("Admin permissions page error:", err);
        res.status(500).json({ error: "Failed to load permissions page" });
      }
    }
  );

  return router;
}

// ─── HTML Rendering ───────────────────────────────────────────────────────────

interface UserRow {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: UserRole;
  permissions: string[];
}

interface AccessGrant {
  id: string;
  scopeType: string;
  account: { id: string; name: string; domain: string | null } | null;
  cachedAccountIds: string[];
  crmReportId: string | null;
  crmProvider: string | null;
  crmReportName: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

function renderPermissionsPage(
  users: UserRow[],
  accessByUser: Record<string, AccessGrant[]>
): string {
  // Sort: OWNER first, then ADMIN, then MEMBER, then VIEWER
  const roleOrder: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3 };
  const sorted = [...users].sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));

  const tableRows = sorted.map((user) => renderUserRow(user, accessByUser[user.userId])).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Admin - Permissions</title>
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
      --color-border-light: #f0f1f3;
      --color-success: #059669;
      --color-success-light: #ecfdf5;
      --color-warning: #d97706;
      --color-warning-light: #fffbeb;
      --color-danger: #dc2626;
      --color-toggle-on: #4f46e5;
      --color-toggle-off: #d1d5db;
      --color-toggle-disabled: #e5e7eb;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', monospace;
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
    .page-wrapper {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    .page-header {
      margin-bottom: 2rem;
    }

    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
      margin-bottom: 0.25rem;
    }

    .page-header p {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
    }

    /* ─── Table Container ───────────────────────────────────────── */
    .table-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .permissions-table {
      width: 100%;
      border-collapse: collapse;
    }

    .permissions-table thead th {
      background: var(--color-bg);
      padding: 0.75rem 1rem;
      text-align: left;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-secondary);
      border-bottom: 1px solid var(--color-border);
      white-space: nowrap;
    }

    .permissions-table thead th.perm-col {
      text-align: center;
      min-width: 80px;
    }

    .permissions-table tbody tr.user-row {
      border-bottom: 1px solid var(--color-border-light);
      transition: background-color 0.15s;
    }

    .permissions-table tbody tr.user-row:hover {
      background-color: #fafbfc;
    }

    .permissions-table tbody tr.user-row:last-child {
      border-bottom: none;
    }

    .permissions-table td {
      padding: 0.875rem 1rem;
      vertical-align: middle;
    }

    .permissions-table td.perm-cell {
      text-align: center;
    }

    /* ─── User Info ─────────────────────────────────────────────── */
    .user-name {
      font-weight: 600;
      color: var(--color-text);
      display: block;
      margin-bottom: 1px;
    }

    .user-email {
      font-size: 0.8rem;
      color: var(--color-text-muted);
    }

    /* ─── Role Badge ────────────────────────────────────────────── */
    .role-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .role-badge--OWNER {
      background: #fef3c7;
      color: #92400e;
    }

    .role-badge--ADMIN {
      background: var(--color-accent-light);
      color: var(--color-accent);
    }

    .role-badge--MEMBER {
      background: #f0f1f3;
      color: var(--color-text-secondary);
    }

    .role-badge--VIEWER {
      background: #f0f1f3;
      color: var(--color-text-muted);
    }

    /* ─── Toggle Switch ─────────────────────────────────────────── */
    .toggle-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
      appearance: none;
      -webkit-appearance: none;
      background: var(--color-toggle-off);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
      outline: none;
      border: none;
    }

    .toggle:checked {
      background: var(--color-toggle-on);
    }

    .toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }

    .toggle:checked::after {
      transform: translateX(16px);
    }

    .toggle:disabled {
      background: var(--color-toggle-disabled);
      cursor: not-allowed;
      opacity: 0.7;
    }

    .toggle:disabled:checked {
      background: #a5b4fc;
      opacity: 0.7;
    }

    .toggle:not(:disabled):hover {
      filter: brightness(0.95);
    }

    .toggle.loading {
      opacity: 0.5;
      pointer-events: none;
    }

    /* ─── Admin-Only Indicator ──────────────────────────────────── */
    .admin-only-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--color-warning);
      background: var(--color-warning-light);
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 4px;
      vertical-align: middle;
      white-space: nowrap;
    }

    .admin-only-badge svg {
      width: 10px;
      height: 10px;
    }

    .perm-header-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    /* ─── Expand Button ─────────────────────────────────────────── */
    .expand-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0.3rem 0.6rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface);
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .expand-btn:hover {
      background: var(--color-bg);
      border-color: var(--color-text-muted);
    }

    .expand-btn svg {
      width: 12px;
      height: 12px;
      transition: transform 0.2s;
    }

    .expand-btn.expanded svg {
      transform: rotate(180deg);
    }

    /* ─── Expanded Access Row ───────────────────────────────────── */
    .access-row {
      display: none;
    }

    .access-row.visible {
      display: table-row;
    }

    .access-row td {
      padding: 0 1rem 1rem;
      background: #fafbfc;
      border-bottom: 1px solid var(--color-border-light);
    }

    .access-panel {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1rem;
    }

    .access-panel-header {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-secondary);
      margin-bottom: 0.75rem;
    }

    .access-grant {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--color-border-light);
    }

    .access-grant:last-child {
      border-bottom: none;
    }

    .access-grant-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .access-grant-icon svg {
      width: 16px;
      height: 16px;
    }

    .access-grant-icon--all {
      background: var(--color-success-light);
      color: var(--color-success);
    }

    .access-grant-icon--single {
      background: var(--color-accent-light);
      color: var(--color-accent);
    }

    .access-grant-icon--list {
      background: #faf5ff;
      color: #7c3aed;
    }

    .access-grant-icon--crm {
      background: #fff7ed;
      color: #ea580c;
    }

    .access-grant-info {
      flex: 1;
      min-width: 0;
    }

    .access-grant-title {
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--color-text);
    }

    .access-grant-detail {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }

    .no-grants {
      color: var(--color-text-muted);
      font-size: 0.85rem;
      font-style: italic;
      padding: 0.5rem 0;
    }

    /* ─── Toast Notification ────────────────────────────────────── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--color-text);
      color: white;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 1000;
    }

    .toast.visible {
      transform: translateY(0);
      opacity: 1;
    }

    .toast.error {
      background: var(--color-danger);
    }

    /* ─── Responsive ────────────────────────────────────────────── */
    @media (max-width: 900px) {
      .page-wrapper { padding: 1rem; }
      .permissions-table { font-size: 0.8rem; }
      .permissions-table thead th,
      .permissions-table td { padding: 0.5rem 0.5rem; }
      .toggle { width: 30px; height: 17px; }
      .toggle::after { width: 13px; height: 13px; }
      .toggle:checked::after { transform: translateX(13px); }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="page-wrapper">
    <header class="page-header">
      <h1>Permissions</h1>
      <p>Manage user permissions for your organization. Owners and Admins have all permissions by default.</p>
    </header>

    <div class="table-container">
      <table class="permissions-table">
        <thead>
          <tr>
            <th style="min-width: 200px;">User</th>
            <th style="min-width: 80px;">Role</th>
${PERMISSION_COLUMNS.map(
  (col) =>
    `            <th class="perm-col">
              <div class="perm-header-label">
                <span>${col.label}</span>${
                  col.adminOnly
                    ? `\n                <span class="admin-only-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>Admin Only</span>`
                    : ""
                }
              </div>
            </th>`
).join("\n")}
            <th style="width: 50px;"></th>
          </tr>
        </thead>
        <tbody>
${tableRows}
        </tbody>
      </table>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // ─── Toggle Permission ─────────────────────────────────────
    async function togglePermission(checkbox, userId, permission) {
      const isGranting = checkbox.checked;
      checkbox.classList.add('loading');

      try {
        const endpoint = isGranting
          ? '/api/dashboard/permissions/grant'
          : '/api/dashboard/permissions/revoke';

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, permission: permission }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.message || 'Request failed');
        }

        showToast(isGranting
          ? 'Permission granted'
          : 'Permission revoked'
        );
      } catch (err) {
        // Revert on failure
        checkbox.checked = !isGranting;
        showToast(err.message || 'Failed to update permission', true);
      } finally {
        checkbox.classList.remove('loading');
      }
    }

    // ─── Expand/Collapse Access Row ────────────────────────────
    function toggleAccessRow(userId) {
      const btn = document.getElementById('expand-btn-' + userId);
      const row = document.getElementById('access-row-' + userId);
      if (!btn || !row) return;

      const isExpanded = row.classList.contains('visible');
      row.classList.toggle('visible');
      btn.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', !isExpanded);
    }

    // ─── Toast ─────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(message, isError) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast visible' + (isError ? ' error' : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.className = 'toast';
      }, 2500);
    }
  </script>
</body>
</html>`;
}

// ─── Row Renderers ──────────────────────────────────────────────────────────

function renderUserRow(user: UserRow, grants?: AccessGrant[]): string {
  const isAdmin = ADMIN_ROLES.includes(user.role);
  const hasGrants = grants && grants.length > 0;
  const isExpandable = !isAdmin && grants !== undefined;

  const displayName = escapeHtml(user.userName ?? user.userEmail.split("@")[0]);
  const displayEmail = escapeHtml(user.userEmail);

  const toggleCells = PERMISSION_COLUMNS.map((col) => {
    const hasPermission = isAdmin || user.permissions.includes(col.key);
    const disabled = isAdmin;

    if (disabled) {
      return `      <td class="perm-cell">
        <div class="toggle-wrap">
          <input type="checkbox" class="toggle" checked disabled
            title="${col.label} (always on for ${user.role})" />
        </div>
      </td>`;
    }

    return `      <td class="perm-cell">
        <div class="toggle-wrap">
          <input type="checkbox" class="toggle"
            ${hasPermission ? "checked" : ""}
            onchange="togglePermission(this, '${user.userId}', '${col.key}')"
            title="${hasPermission ? "Revoke" : "Grant"} ${col.label}" />
        </div>
      </td>`;
  }).join("\n");

  const expandCell = isExpandable
    ? `      <td>
        <button class="expand-btn" id="expand-btn-${user.userId}"
          onclick="toggleAccessRow('${user.userId}')"
          aria-expanded="false"
          aria-controls="access-row-${user.userId}"
          title="View account access">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
          Access
        </button>
      </td>`
    : `      <td></td>`;

  let html = `    <tr class="user-row">
      <td>
        <span class="user-name">${displayName}</span>
        <span class="user-email">${displayEmail}</span>
      </td>
      <td><span class="role-badge role-badge--${user.role}">${user.role}</span></td>
${toggleCells}
${expandCell}
    </tr>`;

  // Add expandable access row for non-admin users
  if (isExpandable) {
    html += `\n    <tr class="access-row" id="access-row-${user.userId}">
      <td colspan="${PERMISSION_COLUMNS.length + 3}">
        <div class="access-panel">
          <div class="access-panel-header">Account Access Grants</div>
${hasGrants ? grants.map(renderAccessGrant).join("\n") : '          <div class="no-grants">No account access grants configured.</div>'}
        </div>
      </td>
    </tr>`;
  }

  return html;
}

function renderAccessGrant(grant: AccessGrant): string {
  let iconClass = "";
  let iconSvg = "";
  let title = "";
  let detail = "";

  switch (grant.scopeType) {
    case "ALL_ACCOUNTS":
      iconClass = "access-grant-icon--all";
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
      title = "All Accounts";
      detail = "Unrestricted access to all accounts";
      break;

    case "SINGLE_ACCOUNT":
      iconClass = "access-grant-icon--single";
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      title = grant.account ? escapeHtml(grant.account.name) : "Single Account";
      detail = grant.account?.domain ? escapeHtml(grant.account.domain) : "Account ID: " + (grant.account?.id ?? "unknown");
      break;

    case "ACCOUNT_LIST":
      iconClass = "access-grant-icon--list";
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
      title = "Account List";
      detail = `${grant.cachedAccountIds.length} account${grant.cachedAccountIds.length === 1 ? "" : "s"}`;
      break;

    case "CRM_REPORT":
      iconClass = "access-grant-icon--crm";
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      title = grant.crmReportName
        ? escapeHtml(grant.crmReportName)
        : "CRM Report";
      detail = [
        grant.crmProvider ?? "",
        `${grant.cachedAccountIds.length} synced account${grant.cachedAccountIds.length === 1 ? "" : "s"}`,
        grant.lastSyncedAt
          ? `Last sync: ${new Date(grant.lastSyncedAt).toLocaleDateString()}`
          : "Not yet synced",
      ]
        .filter(Boolean)
        .join(" \u00B7 ");
      break;

    default:
      iconClass = "access-grant-icon--single";
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
      title = grant.scopeType;
      detail = "";
  }

  return `          <div class="access-grant">
            <div class="access-grant-icon ${iconClass}">${iconSvg}</div>
            <div class="access-grant-info">
              <div class="access-grant-title">${title}</div>
              <div class="access-grant-detail">${detail}</div>
            </div>
          </div>`;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
