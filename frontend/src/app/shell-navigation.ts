import { isGroup, type NavEntry } from "./nav-config";

const BREADCRUMB_LABEL_MAP: Record<string, string> = {
  admin: "Administration",
  account: "Account",
  "account-access": "Account Access",
  permissions: "Permissions",
  roles: "Roles",
  "story-context": "Story Context",
  "audit-logs": "Audit Logs",
  ops: "Operations",
  security: "Security",
  governance: "Governance",
  "publish-approvals": "Publish Approvals",
  "data-quality": "Data Quality",
  "ai-usage": "AI Usage",
  setup: "Setup",
  billing: "Billing",
  accounts: "Accounts",
  stories: "Stories",
  quotes: "Quotes",
  taxonomy: "Taxonomy",
  "my-queue": "My Queue",
  "content-queue": "Content Queue",
  dashboard: "Dashboard",
  pages: "Pages",
  chat: "Chat",
  analytics: "Analytics",
  calls: "Calls",
  transcript: "Transcript",
  workspaces: "Workspaces",
  writebacks: "Writebacks",
  automations: "Automations",
  status: "Status",
  platform: "Platform",
  "account-settings": "Account Settings",
  settings: "Settings",
  auth: "Auth",
  invite: "Invite",
};

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function buildAppBreadcrumbItems(path: string): BreadcrumbItem[] | null {
  if (path === "/") return null;
  if (/^\/accounts\/[^/]+(\/journey)?$/.test(path)) return null;
  if (/^\/pages\/[^/]+\/edit$/.test(path)) return null;

  const segments = path.split("/").filter(Boolean);
  let builtPath = "";
  const items: BreadcrumbItem[] = [{ label: "Home", to: "/" }];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    builtPath += `/${segment}`;
    const isLast = index === segments.length - 1;
    const isLikelyId = /^[a-z0-9-]{10,}$/i.test(segment);
    const label = isLikelyId ? "Details" : (BREADCRUMB_LABEL_MAP[segment] ?? segment);
    items.push({
      label,
      to: isLast ? undefined : builtPath,
    });
  }

  return items;
}

export function buildQuickNavMatches(
  nav: NavEntry[],
  query: string
): Array<{ to: string; label: string }> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const flattened: Array<{ to: string; label: string }> = [];
  for (const entry of nav) {
    if (isGroup(entry)) {
      for (const item of entry.items) {
        flattened.push({ to: item.to, label: item.label });
      }
    } else {
      flattened.push({ to: entry.to, label: entry.label });
    }
  }

  return flattened
    .filter((item) => item.label.toLowerCase().includes(normalized))
    .slice(0, 10);
}
