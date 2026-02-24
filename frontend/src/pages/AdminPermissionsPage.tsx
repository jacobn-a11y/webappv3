/**
 * Admin Permissions Page
 *
 * Displays a table of all org users with toggle switches for each permission.
 * OWNER/ADMIN roles show all toggles as permanently on (disabled).
 * Non-admin rows are expandable to show account access grants.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getPermissions,
  grantPermission,
  revokePermission,
  type PermissionUser,
  type PermissionAccessGrant,
} from "../lib/api";
import { useToast } from "../components/Toast";
import { formatEnumLabel } from "../lib/format";

// ─── Constants ──────────────────────────────────────────────────────────────

const PERMISSION_COLUMNS = [
  { key: "CREATE_LANDING_PAGE", label: "Create", adminOnly: false },
  { key: "PUBLISH_LANDING_PAGE", label: "Publish", adminOnly: false },
  { key: "PUBLISH_NAMED_LANDING_PAGE", label: "Publish Named", adminOnly: true },
  { key: "EDIT_ANY_LANDING_PAGE", label: "Edit Any", adminOnly: false },
  { key: "DELETE_ANY_LANDING_PAGE", label: "Delete Any", adminOnly: false },
  { key: "VIEW_ANALYTICS", label: "Analytics", adminOnly: false },
] as const;

const ADMIN_ROLES = ["OWNER", "ADMIN"];

const ROLE_ORDER: Record<string, number> = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
  VIEWER: 3,
};

const TOTAL_COLUMNS = PERMISSION_COLUMNS.length + 3; // user + role + perms + expand

// ─── Main Component ─────────────────────────────────────────────────────────

export function AdminPermissionsPage() {
  const [users, setUsers] = useState<PermissionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [loadingCells, setLoadingCells] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  // ── Fetch users ───────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);
    getPermissions()
      .then((res) => {
        const sorted = [...res.users].sort(
          (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
        );
        setUsers(sorted);
      })
      .catch((err) => {
        setError(err.message || "Failed to load permissions");
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Toggle a permission ───────────────────────────────────────────────

  const handleToggle = useCallback(
    async (userId: string, permissionKey: string, currentlyGranted: boolean) => {
      const cellKey = `${userId}:${permissionKey}`;
      setLoadingCells((prev) => new Set(prev).add(cellKey));

      // Optimistic update
      const isGranting = !currentlyGranted;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.userId !== userId) return u;
          const permissions = isGranting
            ? [...u.permissions, permissionKey]
            : u.permissions.filter((p) => p !== permissionKey);
          return { ...u, permissions };
        })
      );

      try {
        if (isGranting) {
          await grantPermission(userId, permissionKey);
        } else {
          await revokePermission(userId, permissionKey);
        }
        showToast(isGranting ? "Permission granted" : "Permission revoked", "success");
      } catch (err) {
        // Rollback on error
        setUsers((prev) =>
          prev.map((u) => {
            if (u.userId !== userId) return u;
            const permissions = isGranting
              ? u.permissions.filter((p) => p !== permissionKey)
              : [...u.permissions, permissionKey];
            return { ...u, permissions };
          })
        );
        showToast(
          err instanceof Error ? err.message : "Failed to update permission",
          "error"
        );
      } finally {
        setLoadingCells((prev) => {
          const next = new Set(prev);
          next.delete(cellKey);
          return next;
        });
      }
    },
    [showToast]
  );

  // ── Expand / collapse ─────────────────────────────────────────────────

  const toggleExpand = useCallback((userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page">
        <div className="page__header">
          <div className="page__header-text">
            <h1 className="page__title">Permissions</h1>
            <p className="page__subtitle">Manage user permissions for your organization.</p>
          </div>
        </div>
        <div className="state-view admin-perm__state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading permissions...</div>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="page">
        <div className="page__header">
          <div className="page__header-text">
            <h1 className="page__title">Permissions</h1>
          </div>
        </div>
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Permissions</h1>
          <p className="page__subtitle">
            Manage user permissions for your organization. Owners and Admins have
            all permissions by default.
          </p>
        </div>
      </div>

      <div className="admin-perm__table-container">
        <table className="admin-perm__table">
          <thead>
            <tr>
              <th className="admin-perm__th admin-perm__th--user">
                User
              </th>
              <th className="admin-perm__th admin-perm__th--role">
                Role
              </th>
              {PERMISSION_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="admin-perm__th admin-perm__th--perm"
                >
                  <div className="admin-perm__perm-header">
                    <span>{col.label}</span>
                    {col.adminOnly && (
                      <span className="admin-perm__admin-badge">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          aria-hidden="true"
                        >
                          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Admin Only
                      </span>
                    )}
                  </div>
                </th>
              ))}
              <th className="admin-perm__th admin-perm__th--expand" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.userId}
                user={user}
                expanded={expandedUsers.has(user.userId)}
                loadingCells={loadingCells}
                onToggle={handleToggle}
                onExpand={toggleExpand}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── User Row ───────────────────────────────────────────────────────────────

interface UserRowProps {
  user: PermissionUser;
  expanded: boolean;
  loadingCells: Set<string>;
  onToggle: (userId: string, permKey: string, current: boolean) => void;
  onExpand: (userId: string) => void;
}

function UserRow({
  user,
  expanded,
  loadingCells,
  onToggle,
  onExpand,
}: UserRowProps) {
  const isAdmin = ADMIN_ROLES.includes(user.role);
  const isExpandable = !isAdmin;
  const displayName = user.userName ?? user.userEmail.split("@")[0];

  return (
    <>
      <tr className="admin-perm__row">
        <td className="admin-perm__td">
          <span className="admin-perm__user-name">{displayName}</span>
          <span className="admin-perm__user-email">{user.userEmail}</span>
        </td>
        <td className="admin-perm__td">
          <span
            className={`admin-perm__role-badge admin-perm__role-badge--${user.role}`}
          >
            {formatEnumLabel(user.role)}
          </span>
        </td>
        {PERMISSION_COLUMNS.map((col) => {
          const hasPermission =
            isAdmin || user.permissions.includes(col.key);
          const cellKey = `${user.userId}:${col.key}`;
          const isCellLoading = loadingCells.has(cellKey);

          return (
            <td
              key={col.key}
              className="admin-perm__td admin-perm__td--perm"
            >
              <div className="admin-perm__toggle-wrap">
                <input
                  type="checkbox"
                  className={
                    "admin-perm__toggle" +
                    (isCellLoading ? " admin-perm__toggle--loading" : "")
                  }
                  checked={hasPermission}
                  disabled={isAdmin || isCellLoading}
                  title={
                    isAdmin
                      ? `${col.label} (always on for ${formatEnumLabel(user.role)})`
                      : `${hasPermission ? "Revoke" : "Grant"} ${col.label}`
                  }
                  onChange={() =>
                    onToggle(user.userId, col.key, hasPermission)
                  }
                />
              </div>
            </td>
          );
        })}
        <td className="admin-perm__td">
          {isExpandable && (
            <button
              type="button"
              className={
                "admin-perm__expand-btn" +
                (expanded ? " admin-perm__expand-btn--expanded" : "")
              }
              onClick={() => onExpand(user.userId)}
              aria-expanded={expanded}
              title="View account access"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <polyline points="6,9 12,15 18,9" />
              </svg>
              Access
            </button>
          )}
        </td>
      </tr>

      {/* Expandable access grants row */}
      {isExpandable && expanded && (
        <tr className="admin-perm__access-row">
          <td colSpan={TOTAL_COLUMNS}>
            <AccessPanel grants={user.accessGrants} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Access Panel ───────────────────────────────────────────────────────────

function AccessPanel({
  grants,
}: {
  grants?: PermissionAccessGrant[];
}) {
  const hasGrants = grants && grants.length > 0;

  return (
    <div className="admin-perm__access-panel">
      <div className="admin-perm__access-panel-header">
        Account Access Grants
      </div>
      {hasGrants ? (
        grants.map((grant) => (
          <AccessGrantRow key={grant.id} grant={grant} />
        ))
      ) : (
        <div className="admin-perm__no-grants">
          No account access grants configured.
        </div>
      )}
    </div>
  );
}

// ─── Access Grant Row ───────────────────────────────────────────────────────

function AccessGrantRow({ grant }: { grant: PermissionAccessGrant }) {
  const { iconClass, icon, title, detail } = getGrantDisplay(grant);

  return (
    <div className="admin-perm__access-grant">
      <div className={`admin-perm__access-grant-icon ${iconClass}`}>
        {icon}
      </div>
      <div className="admin-perm__access-grant-info">
        <div className="admin-perm__access-grant-title">{title}</div>
        <div className="admin-perm__access-grant-detail">{detail}</div>
      </div>
    </div>
  );
}

function getGrantDisplay(grant: PermissionAccessGrant): {
  iconClass: string;
  icon: JSX.Element;
  title: string;
  detail: string;
} {
  switch (grant.scopeType) {
    case "ALL_ACCOUNTS":
      return {
        iconClass: "admin-perm__access-grant-icon--all",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
          </svg>
        ),
        title: "All Accounts",
        detail: "Unrestricted access to all accounts",
      };

    case "SINGLE_ACCOUNT":
      return {
        iconClass: "admin-perm__access-grant-icon--single",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
        title: grant.account ? grant.account.name : "Single Account",
        detail: grant.account?.domain
          ? grant.account.domain
          : `Account ID: ${grant.account?.id ?? "unknown"}`,
      };

    case "ACCOUNT_LIST":
      return {
        iconClass: "admin-perm__access-grant-icon--list",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        ),
        title: "Account List",
        detail: `${grant.cachedAccountIds.length} account${grant.cachedAccountIds.length === 1 ? "" : "s"}`,
      };

    case "CRM_REPORT":
      return {
        iconClass: "admin-perm__access-grant-icon--crm",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        ),
        title: grant.crmReportName ?? "CRM Report",
        detail: [
          grant.crmProvider ?? "",
          `${grant.cachedAccountIds.length} synced account${grant.cachedAccountIds.length === 1 ? "" : "s"}`,
          grant.lastSyncedAt
            ? `Last sync: ${new Date(grant.lastSyncedAt).toLocaleDateString()}`
            : "Not yet synced",
        ]
          .filter(Boolean)
          .join(" \u00B7 "),
      };

    default:
      return {
        iconClass: "admin-perm__access-grant-icon--single",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
          </svg>
        ),
        title: grant.scopeType,
        detail: "",
      };
  }
}
