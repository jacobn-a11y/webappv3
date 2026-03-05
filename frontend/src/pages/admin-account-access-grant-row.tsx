import type { ReactNode } from "react";
import type { AccessGrant } from "../lib/api";

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return diffMins + "m ago";
  if (diffHours < 24) return diffHours + "h ago";
  if (diffDays < 7) return diffDays + "d ago";
  return d.toLocaleDateString();
}

export function GrantRow({
  grant,
  onRevoke,
  onSync,
}: {
  grant: AccessGrant;
  onRevoke: (grantId: string) => void;
  onSync: (grantId: string) => void;
}) {
  let badge: ReactNode = null;
  let detail: ReactNode = null;
  let syncButton: ReactNode = null;

  switch (grant.scope_type) {
    case "ALL_ACCOUNTS":
      badge = <span className="admin-access__badge admin-access__badge--all">All Accounts</span>;
      break;

    case "SINGLE_ACCOUNT":
      badge = (
        <span className="admin-access__badge admin-access__badge--account">Single Account</span>
      );
      if (grant.account) {
        detail = (
          <span className="admin-access__grant-accounts">
            {grant.account.name}
            {grant.account.domain && (
              <span className="admin-access__grant-domain">
                {" "}({grant.account.domain})
              </span>
            )}
          </span>
        );
      }
      break;

    case "ACCOUNT_LIST":
      badge = (
        <span className="admin-access__badge admin-access__badge--list">Specific Accounts</span>
      );
      detail = (
        <span className="admin-access__grant-accounts">
          {grant.cached_account_count} account
          {grant.cached_account_count !== 1 ? "s" : ""}
        </span>
      );
      break;

    case "CRM_REPORT":
      badge = <span className="admin-access__badge admin-access__badge--crm">CRM Report</span>;
      detail = (
        <>
          <span className="admin-access__grant-accounts">
            {grant.crm_report_name || grant.crm_report_id || "Unknown"}
          </span>
          <span className="admin-access__crm-sync-info">
            {grant.crm_provider && <>{grant.crm_provider}</>}
            {" \u00B7 "}
            {grant.cached_account_count} account
            {grant.cached_account_count !== 1 ? "s" : ""}
            {" \u00B7 "}
            {grant.last_synced_at
              ? "Synced " + formatRelativeTime(grant.last_synced_at)
              : "Never synced"}
          </span>
        </>
      );
      syncButton = (
        <button
          type="button"
          className="admin-access__btn admin-access__btn--sync"
          onClick={() => onSync(grant.id)}
          title="Sync Now"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          {" "}Sync
        </button>
      );
      break;
  }

  return (
    <div className="admin-access__grant-row" key={grant.id}>
      <div className="admin-access__grant-info">
        {badge}
        {detail}
      </div>
      <div className="admin-access__grant-actions">
        {syncButton}
        <button
          type="button"
          className="admin-access__btn admin-access__btn--danger"
          onClick={() => onRevoke(grant.id)}
          title="Revoke"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          {" "}Revoke
        </button>
      </div>
    </div>
  );
}
