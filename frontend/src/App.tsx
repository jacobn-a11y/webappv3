import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { LandingPageEditorPage } from "./pages/LandingPageEditorPage";
import { AdminAccountAccessPage } from "./pages/AdminAccountAccessPage";
import { AdminPermissionsPage } from "./pages/AdminPermissionsPage";
import { TranscriptViewerPage } from "./pages/TranscriptViewerPage";
import { DashboardPagesPage } from "./pages/DashboardPagesPage";
import { ChatbotConnectorPage } from "./pages/ChatbotConnectorPage";
import { AnalyticsDashboardPage } from "./pages/AnalyticsDashboardPage";
import { AccountJourneyPage } from "./pages/AccountJourneyPage";
import { AdminRolesPage } from "./pages/AdminRolesPage";
import { AdminStoryContextPage } from "./pages/AdminStoryContextPage";
import { AdminAuditLogsPage } from "./pages/AdminAuditLogsPage";
import { AdminOpsDiagnosticsPage } from "./pages/AdminOpsDiagnosticsPage";
import { AdminSecurityPolicyPage } from "./pages/AdminSecurityPolicyPage";
import { AdminDataGovernancePage } from "./pages/AdminDataGovernancePage";
import { AdminPublishApprovalsPage } from "./pages/AdminPublishApprovalsPage";
import { AdminDataQualityPage } from "./pages/AdminDataQualityPage";
import { AdminSetupWizardPage } from "./pages/AdminSetupWizardPage";
import { AdminBillingReadinessPage } from "./pages/AdminBillingReadinessPage";
import { HomePage } from "./pages/HomePage";
import { PlatformOwnerDashboardPage } from "./pages/PlatformOwnerDashboardPage";
import { AccountSettingsPage } from "./pages/AccountSettingsPage";
import { AccountsIndexPage } from "./pages/AccountsIndexPage";
import {
  clearAuthState,
  getAuthMe,
  getRoleAwareHome,
  getStoredAuthUser,
  logoutSelfService,
  subscribeAuthChanges,
  type RoleAwareHome,
  type AuthUser,
} from "./lib/api";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { WritebacksPage } from "./pages/WritebacksPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { StatusPage } from "./pages/StatusPage";
import { AuthPage } from "./pages/AuthPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { ProtectedRoute, AccessDenied } from "./components/ProtectedRoute";

// ─── SVG Nav Icons (20x20 stroke) ────────────────────────────────────────────

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></svg>
  );
}
function IconStatus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
  );
}
function IconAccounts() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  );
}
function IconPages() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
  );
}
function IconAnalytics() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
  );
}
function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
  );
}
function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  );
}
function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
  );
}
function IconKey() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
  );
}
function IconBook() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
  );
}
function IconClipboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>
  );
}
function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
  );
}
function IconActivity() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>
  );
}
function IconLock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
  );
}
function IconDatabase() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
  );
}
function IconCheckCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
  );
}
function IconStar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" /></svg>
  );
}
function IconTool() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
  );
}
function IconCreditCard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
  );
}
function IconFolder() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
  );
}
function IconRefresh() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
  );
}
function IconZap() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></svg>
  );
}
function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5.5l3 3 3-3" /></svg>
  );
}
function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
  );
}
function IconCollapse() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11,17 6,12 11,7" /><polyline points="18,17 13,12 18,7" /></svg>
  );
}
function IconExpand() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13,17 18,12 13,7" /><polyline points="6,17 11,12 6,7" /></svg>
  );
}
function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  );
}

// ─── Navigation Configuration ─────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: () => JSX.Element;
}

interface NavGroup {
  label: string;
  icon: () => JSX.Element;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

function buildNav(persona: RoleAwareHome["persona"] | null, userRole: AuthUser["role"]): NavEntry[] {
  const primary: NavItem[] = [
    { to: "/", label: "Home", icon: IconHome },
    { to: "/status", label: "Status", icon: IconStatus },
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

  // Core items — Accounts available to MEMBER (content creators), SALES, CSM
  if (isSales || isCSM || isMember || isAdmin) {
    coreItems.push({ to: "/accounts", label: "Accounts", icon: IconAccounts });
  }
  coreItems.push({ to: "/dashboard/pages", label: "Pages", icon: IconPages });
  coreItems.push({ to: "/analytics", label: "Analytics", icon: IconAnalytics });

  if (isAdmin || isMarketing || isSales) {
    coreItems.push({ to: "/chat", label: "Chat", icon: IconChat });
  }

  // Admin section — only for actual admin roles
  if (isAdminRole) {
    if (isAdmin) {
      adminItems.push(
        { to: "/admin/permissions", label: "Permissions", icon: IconKey },
        { to: "/admin/roles", label: "Roles", icon: IconUsers },
        { to: "/admin/story-context", label: "Story Context", icon: IconBook },
        { to: "/admin/audit-logs", label: "Audit Logs", icon: IconClipboard },
        { to: "/admin/ops", label: "Operations", icon: IconActivity },
        { to: "/admin/security", label: "Security", icon: IconLock },
        { to: "/admin/governance", label: "Governance", icon: IconDatabase },
        { to: "/admin/publish-approvals", label: "Approvals", icon: IconCheckCircle },
        { to: "/admin/data-quality", label: "Data Quality", icon: IconStar },
        { to: "/admin/setup", label: "Setup", icon: IconTool },
      );
      // Billing only for OWNER
      if (userRole === "OWNER") {
        adminItems.push({ to: "/admin/billing", label: "Billing", icon: IconCreditCard });
      }
    }
  } else if (isMarketing) {
    adminItems.push({ to: "/admin/story-context", label: "Story Context", icon: IconBook });
  }
  // Non-admin roles: no admin items

  // Workspace items — not for VIEWER or EXEC
  if (!isViewer && !isExec) {
    workItems.push({ to: "/workspaces", label: "Workspaces", icon: IconFolder });
    if (isAdmin || isMarketing || isSales) {
      workItems.push({ to: "/writebacks", label: "Writebacks", icon: IconRefresh });
      workItems.push({ to: "/automations", label: "Automations", icon: IconZap });
    }
  }

  const nav: NavEntry[] = [...primary, ...coreItems];

  if (adminItems.length > 0) {
    nav.push({ label: "Administration", icon: IconShield, items: adminItems });
  }

  if (workItems.length > 0) {
    nav.push({ label: "Workspace", icon: IconSettings, items: workItems });
  }

  // Account settings (OWNER only)
  if (userRole === "OWNER") {
    nav.push({ to: "/account-settings", label: "Account Settings", icon: IconSettings });
  }

  return nav;
}

// ─── Sidebar Component ────────────────────────────────────────────────────────

const COLLAPSE_KEY = "sidebar_collapsed";
const GROUPS_KEY = "sidebar_groups";

function Sidebar({
  nav,
  user,
  collapsed,
  onToggleCollapse,
  onLogout,
  onClose,
}: {
  nav: NavEntry[];
  user: AuthUser;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onLogout: () => void;
  onClose?: () => void;
}) {
  const location = useLocation();

  // Group expand/collapse state
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(GROUPS_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set(["Administration", "Workspace"]);
    } catch {
      return new Set(["Administration", "Workspace"]);
    }
  });

  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  const initials = user.email
    .split("@")[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`} aria-label="Main navigation">
      {/* Logo + Mobile Close */}
      <div className="sidebar__top">
        <Link to="/" className="sidebar__logo" onClick={onClose}>
          <span className="sidebar__logo-text">StoryEngine</span>
        </Link>
        {onClose && (
          <button type="button" className="sidebar__close-btn" onClick={onClose} aria-label="Close navigation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        {nav.map((entry) => {
          if (isGroup(entry)) {
            const isOpen = openGroups.has(entry.label);
            return (
              <div key={entry.label} className="sidebar__group">
                <button
                  type="button"
                  className="sidebar__group-toggle"
                  onClick={() => toggleGroup(entry.label)}
                  aria-expanded={isOpen}
                  title={collapsed ? entry.label : undefined}
                >
                  <span className="sidebar__link-icon"><entry.icon /></span>
                  <span className="sidebar__link-label">{entry.label}</span>
                  <span className={`sidebar__group-chevron${isOpen ? " sidebar__group-chevron--open" : ""}`}>
                    <IconChevron />
                  </span>
                </button>
                <div className={`sidebar__group-items${isOpen ? "" : " sidebar__group-items--collapsed"}`}>
                  {entry.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`sidebar__link${isActive(item.to) ? " sidebar__link--active" : ""}`}
                      aria-current={isActive(item.to) ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      onClick={onClose}
                    >
                      <span className="sidebar__link-icon"><item.icon /></span>
                      <span className="sidebar__link-label">{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <Link
              key={entry.to}
              to={entry.to}
              className={`sidebar__link${isActive(entry.to) ? " sidebar__link--active" : ""}`}
              aria-current={isActive(entry.to) ? "page" : undefined}
              title={collapsed ? entry.label : undefined}
              onClick={onClose}
            >
              <span className="sidebar__link-icon"><entry.icon /></span>
              <span className="sidebar__link-label">{entry.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <div className="sidebar__user">
          <div className="sidebar__avatar" title={user.email}>{initials || "U"}</div>
          <div className="sidebar__user-info">
            <span className="sidebar__user-email">{user.email}</span>
            <span className="sidebar__user-role">{user.role === "OWNER" ? "Owner" : user.role === "ADMIN" ? "Admin" : user.role === "MEMBER" ? "Member" : "Viewer"}</span>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onLogout} title="Logout" style={{ padding: "4px 6px", marginLeft: "auto" }}>
            <IconLogout />
          </button>
        </div>
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <IconExpand /> : <IconCollapse />}
          <span>{collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
    </aside>
  );
}

// ─── Authenticated App ────────────────────────────────────────────────────────

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
}) {
  const [persona, setPersona] = useState<RoleAwareHome["persona"] | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    getRoleAwareHome()
      .then((res) => setPersona(res.persona))
      .catch(() => setPersona(null));
  }, []);

  const nav = useMemo(() => buildNav(persona, user.role), [persona, user.role]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const handleLogout = useCallback(() => {
    void onLogout();
  }, [onLogout]);

  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`}>
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* Mobile header */}
      <div className="mobile-header">
        <button type="button" className="mobile-header__hamburger" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <IconMenu />
        </button>
        <Link to="/" className="mobile-header__logo">StoryEngine</Link>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <Sidebar
        nav={nav}
        user={user}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onLogout={handleLogout}
        onClose={mobileOpen ? () => setMobileOpen(false) : undefined}
      />

      {/* Main content */}
      <main className="app-content" id="main-content">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/accounts" element={<AccountsIndexPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage userRole={user.role} />} />
            <Route path="/accounts/:accountId/journey" element={<AccountJourneyPage />} />
            <Route path="/pages/:pageId/edit" element={<LandingPageEditorPage />} />
            <Route path="/admin/account-access" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminAccountAccessPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/permissions" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminPermissionsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/roles" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminRolesPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/story-context" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN", "MEMBER"]} user={user} >
                <AdminStoryContextPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/audit-logs" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminAuditLogsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/ops" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminOpsDiagnosticsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/security" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminSecurityPolicyPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/governance" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminDataGovernancePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/publish-approvals" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminPublishApprovalsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/data-quality" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminDataQualityPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/setup" element={
              <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} >
                <AdminSetupWizardPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/billing" element={
              <ProtectedRoute requiredRole={["OWNER"]} user={user} >
                <AdminBillingReadinessPage />
              </ProtectedRoute>
            } />
            <Route path="/workspaces" element={<WorkspacesPage userRole={user.role} />} />
            <Route path="/writebacks" element={<WritebacksPage userRole={user.role} />} />
            <Route path="/automations" element={<AutomationsPage userRole={user.role} />} />
            <Route path="/status" element={<StatusPage userOrgId={user.organizationId} />} />
            <Route path="/platform" element={
              <ProtectedRoute requiredRole={["OWNER"]} user={user} fallback={<AccessDenied />}>
                <PlatformOwnerDashboardPage />
              </ProtectedRoute>
            } />
            <Route path="/account-settings" element={
              <ProtectedRoute requiredRole={["OWNER"]} user={user}>
                <AccountSettingsPage />
              </ProtectedRoute>
            } />
            <Route path="/calls/:callId/transcript" element={<TranscriptViewerPage />} />
            <Route path="/dashboard/pages" element={<DashboardPagesPage userRole={user.role} />} />
            <Route path="/chat" element={<ChatbotConnectorPage />} />
            <Route path="/analytics" element={<AnalyticsDashboardPage />} />
            <Route path="/settings/billing" element={<Navigate to="/admin/billing" replace />} />
            <Route path="/setup" element={<Navigate to="/admin/setup" replace />} />
            <Route path="/auth" element={<Navigate to="/" replace />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function PublicApp() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/auth?mode=login" replace />} />
    </Routes>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getStoredAuthUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => setUser(getStoredAuthUser());
    const unsubscribe = subscribeAuthChanges(sync);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const existing = getStoredAuthUser();
    if (!existing) {
      setLoading(false);
      return;
    }
    getAuthMe()
      .then((res) => setUser(res.user))
      .catch(() => {
        clearAuthState();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logoutSelfService();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="auth-page" role="status" aria-live="polite">
        <div className="auth-card">
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <h1 className="auth-card__title" style={{ textAlign: "center" }}>Loading workspace</h1>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ToastProvider>
        {user ? <AuthenticatedApp user={user} onLogout={handleLogout} /> : <PublicApp />}
      </ToastProvider>
    </BrowserRouter>
  );
}
