import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
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

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
}) {
  const [persona, setPersona] = useState<RoleAwareHome["persona"] | null>(null);

  useEffect(() => {
    getRoleAwareHome()
      .then((res) => setPersona(res.persona))
      .catch(() => {
        setPersona(null);
      });
  }, []);

  const links = useMemo(() => {
    const base = [
      { to: "/", label: "Home" },
      { to: "/status", label: "Status" },
    ];
    if (!persona || persona === "REVOPS_ADMIN") {
      return [
        ...base,
        { to: "/dashboard/pages", label: "Pages" },
        { to: "/analytics", label: "Analytics" },
        { to: "/chat", label: "Chat" },
        { to: "/admin/permissions", label: "Admin" },
        { to: "/admin/roles", label: "Roles" },
        { to: "/admin/story-context", label: "Story Context" },
        { to: "/admin/audit-logs", label: "Audit Logs" },
        { to: "/admin/ops", label: "Ops" },
        { to: "/admin/security", label: "Security" },
        { to: "/admin/governance", label: "Governance" },
        { to: "/admin/publish-approvals", label: "Publish Approvals" },
        { to: "/admin/data-quality", label: "Data Quality" },
        { to: "/admin/setup", label: "Setup" },
        { to: "/admin/billing", label: "Billing" },
        { to: "/workspaces", label: "Workspaces" },
        { to: "/writebacks", label: "Writebacks" },
        { to: "/automations", label: "Automations" },
      ];
    }
    if (persona === "MARKETING_ANALYST") {
      return [
        ...base,
        { to: "/analytics", label: "Analytics" },
        { to: "/dashboard/pages", label: "Pages" },
        { to: "/chat", label: "Chat" },
        { to: "/workspaces", label: "Workspaces" },
        { to: "/writebacks", label: "Writebacks" },
        { to: "/automations", label: "Automations" },
        { to: "/admin/story-context", label: "Story Context" },
      ];
    }
    if (persona === "SALES_MANAGER") {
      return [
        ...base,
        { to: "/accounts/acc_meridian", label: "Accounts" },
        { to: "/dashboard/pages", label: "Pages" },
        { to: "/analytics", label: "Analytics" },
        { to: "/chat", label: "Chat" },
        { to: "/workspaces", label: "Workspaces" },
        { to: "/writebacks", label: "Writebacks" },
        { to: "/automations", label: "Automations" },
      ];
    }
    if (persona === "CSM") {
      return [
        ...base,
        { to: "/accounts/acc_meridian", label: "Accounts" },
        { to: "/dashboard/pages", label: "Pages" },
        { to: "/analytics", label: "Analytics" },
        { to: "/workspaces", label: "Workspaces" },
      ];
    }
    return [
      ...base,
      { to: "/analytics", label: "Analytics" },
      { to: "/dashboard/pages", label: "Pages" },
      { to: "/admin/audit-logs", label: "Audit Logs" },
    ];
  }, [persona]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/" className="app-nav__logo">
          StoryEngine
        </Link>
        {links.map((item) => (
          <Link key={item.to} to={item.to} className="app-nav__link">
            {item.label}
          </Link>
        ))}
        <div className="app-nav__spacer" />
        <span className="app-nav__user">{user.email}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => void onLogout()}>
          Logout
        </button>
      </nav>
      <main className="app-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          <Route
            path="/accounts/:accountId/journey"
            element={<AccountJourneyPage />}
          />
          <Route path="/pages/:pageId/edit" element={<LandingPageEditorPage />} />
          <Route path="/admin/account-access" element={<AdminAccountAccessPage />} />
          <Route path="/admin/permissions" element={<AdminPermissionsPage />} />
          <Route path="/admin/roles" element={<AdminRolesPage />} />
          <Route path="/admin/story-context" element={<AdminStoryContextPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
          <Route path="/admin/ops" element={<AdminOpsDiagnosticsPage />} />
          <Route path="/admin/security" element={<AdminSecurityPolicyPage />} />
          <Route path="/admin/governance" element={<AdminDataGovernancePage />} />
          <Route
            path="/admin/publish-approvals"
            element={<AdminPublishApprovalsPage />}
          />
          <Route path="/admin/data-quality" element={<AdminDataQualityPage />} />
          <Route path="/admin/setup" element={<AdminSetupWizardPage />} />
          <Route path="/admin/billing" element={<AdminBillingReadinessPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/writebacks" element={<WritebacksPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/calls/:callId/transcript" element={<TranscriptViewerPage />} />
          <Route path="/dashboard/pages" element={<DashboardPagesPage />} />
          <Route path="/chat" element={<ChatbotConnectorPage />} />
          <Route path="/analytics" element={<AnalyticsDashboardPage />} />
          <Route path="/settings/billing" element={<Navigate to="/admin/billing" replace />} />
          <Route path="/setup" element={<Navigate to="/admin/setup" replace />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">Loading workspace</h1>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {user ? <AuthenticatedApp user={user} onLogout={handleLogout} /> : <PublicApp />}
    </BrowserRouter>
  );
}
