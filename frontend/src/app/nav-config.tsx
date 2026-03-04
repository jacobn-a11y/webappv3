import type { AuthUser, RoleAwareHome } from "../lib/api";

type TranslateFn = (key: string, fallback: string) => string;

export interface NavItem {
  to: string;
  label: string;
  icon: () => JSX.Element;
}

export interface NavGroup {
  label: string;
  icon: () => JSX.Element;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

function IconHome() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></svg>
  );
}
function IconStatus() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
  );
}
function IconAccounts() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  );
}
function IconPages() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
  );
}
function IconAnalytics() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
  );
}
function IconChat() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
  );
}
function IconShield() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  );
}
function IconUsers() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
  );
}
function IconKey() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
  );
}
function IconBook() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
  );
}
function IconClipboard() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>
  );
}
function IconSettings() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
  );
}
function IconActivity() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>
  );
}
function IconLock() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
  );
}
function IconDatabase() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
  );
}
function IconCheckCircle() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
  );
}
function IconStar() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" /></svg>
  );
}
function IconTool() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
  );
}
function IconCreditCard() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
  );
}
function IconFolder() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
  );
}
function IconRefresh() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
  );
}
function IconZap() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></svg>
  );
}
export function IconChevron() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5.5l3 3 3-3" /></svg>
  );
}
export function IconMenu() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
  );
}
export function IconCollapse() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11,17 6,12 11,7" /><polyline points="18,17 13,12 18,7" /></svg>
  );
}
export function IconExpand() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13,17 18,12 13,7" /><polyline points="6,17 11,12 6,7" /></svg>
  );
}
export function IconLogout() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  );
}

export function buildNav(
  persona: RoleAwareHome["persona"] | null,
  userRole: AuthUser["role"],
  t: TranslateFn
): NavEntry[] {
  const primary: NavItem[] = [
    { to: "/", label: t("nav.home", "Home"), icon: IconHome },
    { to: "/status", label: t("nav.status", "Status"), icon: IconStatus },
  ];

  const coreItems: NavItem[] = [];
  const adminItems: NavItem[] = [];
  const workItems: NavItem[] = [];

  const isAdminRole = userRole === "OWNER" || userRole === "ADMIN";
  const isAdmin = isAdminRole;
  const isMarketing = persona === "MARKETING_ANALYST";
  const isSales = persona === "SALES_MANAGER";
  const isCSM = persona === "CSM";
  const isExec = persona === "EXEC";
  const isViewer = userRole === "VIEWER";
  const isMember = userRole === "MEMBER";

  if (isSales || isCSM || isMember || isAdmin) {
    coreItems.push({ to: "/accounts", label: t("nav.accounts", "Accounts"), icon: IconAccounts });
  }
  coreItems.push({ to: "/stories", label: t("nav.stories", "Stories"), icon: IconBook });
  coreItems.push({ to: "/dashboard/pages", label: t("nav.pages", "Pages"), icon: IconPages });
  if (!isMember) {
    coreItems.push({ to: "/analytics", label: t("nav.analytics", "Analytics"), icon: IconAnalytics });
  }

  if (isAdmin || isMarketing || isSales) {
    coreItems.push({ to: "/chat", label: t("nav.chat", "Chat"), icon: IconChat });
  }

  if (isAdminRole) {
    if (isAdmin) {
      adminItems.push(
        { to: "/admin/permissions", label: t("nav.permissions", "Permissions"), icon: IconKey },
        { to: "/admin/roles", label: t("nav.roles", "Roles"), icon: IconUsers },
        { to: "/admin/story-context", label: t("nav.story_context", "Story Context"), icon: IconBook },
        { to: "/admin/audit-logs", label: t("nav.audit_logs", "Audit Logs"), icon: IconClipboard },
        { to: "/admin/ops", label: t("nav.operations", "Operations"), icon: IconActivity },
        { to: "/admin/security", label: t("nav.security", "Security"), icon: IconLock },
        { to: "/admin/governance", label: t("nav.governance", "Governance"), icon: IconDatabase },
        { to: "/admin/publish-approvals", label: t("nav.approvals", "Approvals"), icon: IconCheckCircle },
        { to: "/admin/data-quality", label: t("nav.data_quality", "Data Quality"), icon: IconStar },
        { to: "/admin/setup", label: t("nav.setup", "Setup"), icon: IconTool },
        { to: "/admin/settings/integrations", label: t("nav.integrations", "Integrations"), icon: IconRefresh },
      );
      if (userRole === "OWNER") {
        adminItems.push({ to: "/admin/billing", label: t("nav.billing", "Billing"), icon: IconCreditCard });
      }
    }
  } else if (isMarketing) {
    adminItems.push({ to: "/admin/story-context", label: t("nav.story_context", "Story Context"), icon: IconBook });
  }

  if (!isViewer && !isExec && !isMember) {
    workItems.push({ to: "/workspaces", label: t("nav.workspaces", "Workspaces"), icon: IconFolder });
    if (isAdmin || isMarketing || isSales) {
      workItems.push({ to: "/writebacks", label: t("nav.writebacks", "Writebacks"), icon: IconRefresh });
      workItems.push({ to: "/automations", label: t("nav.automations", "Automations"), icon: IconZap });
    }
  }

  const nav: NavEntry[] = [...primary, ...coreItems];

  if (adminItems.length > 0) {
    nav.push({ label: t("nav.group.administration", "Administration"), icon: IconShield, items: adminItems });
  }

  if (workItems.length > 0) {
    nav.push({ label: t("nav.group.workspace", "Workspace"), icon: IconSettings, items: workItems });
  }

  nav.push({ to: "/profile", label: t("nav.profile", "Profile"), icon: IconUsers });

  if (userRole === "OWNER") {
    nav.push({ to: "/account-settings", label: t("nav.account_settings", "Account Settings"), icon: IconSettings });
  }

  return nav;
}
