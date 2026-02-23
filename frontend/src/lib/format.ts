/**
 * Format utilities for display labels and values.
 */

const SPECIAL_LABELS: Record<string, string> = {
  REVOPS: "RevOps",
  CS: "CS",
  CSM: "CSM",
  ROI: "ROI",
  CRM: "CRM",
  SSO: "SSO",
  PII: "PII",
  RTO: "RTO",
  RPO: "RPO",
  SHARED_WITH_LINK: "Shared",
  FIELD_UPDATE: "Field Update",
  TIMELINE_EVENT: "Timeline Event",
  FREE_TRIAL: "Free Trial",
  REVOPS_ADMIN: "RevOps Admin",
  MARKETING_ANALYST: "Marketing Analyst",
  SALES_MANAGER: "Sales Manager",
  ALL_ACCOUNTS: "All Accounts",
  SINGLE_ACCOUNT: "Single Account",
  ACCOUNT_LIST: "Account List",
  CRM_REPORT: "CRM Report",
  CREATE_LANDING_PAGE: "Create Page",
  PUBLISH_LANDING_PAGE: "Publish Page",
  PUBLISH_NAMED_LANDING_PAGE: "Publish Named Page",
  EDIT_ANY_LANDING_PAGE: "Edit Any Page",
  DELETE_ANY_LANDING_PAGE: "Delete Any Page",
  VIEW_ANALYTICS: "Analytics",
  INTEGRATION_FAILURE: "Integration Failure",
};

/**
 * Converts an UPPER_SNAKE_CASE enum value into a human-readable label.
 * E.g. "MARKETING" → "Marketing", "FIELD_UPDATE" → "Field Update"
 */
export function formatEnumLabel(value: string): string {
  if (SPECIAL_LABELS[value]) return SPECIAL_LABELS[value];

  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Format a number with K/M suffixes for display.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

/**
 * Format a date string to a short readable format.
 */
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format a date string to a relative time (e.g. "2 hours ago").
 */
export function formatRelativeTime(dateStr: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateStr);
  } catch {
    return dateStr;
  }
}

/**
 * Get the badge CSS class for a given status string.
 */
export function badgeClass(status: string): string {
  const s = status.toUpperCase();
  switch (s) {
    case "DRAFT":
    case "PENDING":
    case "OWNER":
    case "MONITORING":
      return "badge badge--draft";
    case "PUBLISHED":
    case "ACTIVE":
    case "SUCCESS":
    case "APPROVED":
    case "COMPLETED":
    case "OK":
      return "badge badge--success";
    case "ARCHIVED":
    case "INACTIVE":
    case "PRIVATE":
    case "MEMBER":
    case "VIEWER":
    case "ROLLED_BACK":
      return "badge badge--archived";
    case "ERROR":
    case "CRITICAL":
    case "REJECTED":
    case "FAILED":
    case "OPEN":
      return "badge badge--error";
    case "SHARED":
    case "SHARED_WITH_LINK":
    case "ADMIN":
    case "INFO":
    case "TEAM":
      return "badge badge--info";
    case "WARNING":
    case "MEDIUM":
    case "HIGH":
      return "badge badge--warning";
    default:
      return "badge badge--accent";
  }
}
