import { Navigate, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../lib/api";
import { ProtectedRoute, AccessDenied } from "../components/ProtectedRoute";
import { AccountDetailPage } from "../pages/AccountDetailPage";
import { AccountsIndexPage } from "../pages/AccountsIndexPage";
import { AccountJourneyPage } from "../pages/AccountJourneyPage";
import { AccountSettingsPage } from "../pages/AccountSettingsPage";
import { AdminAccountAccessPage } from "../pages/AdminAccountAccessPage";
import { AdminAuditLogsPage } from "../pages/AdminAuditLogsPage";
import { AdminBillingReadinessPage } from "../pages/AdminBillingReadinessPage";
import { AdminDataGovernancePage } from "../pages/AdminDataGovernancePage";
import { AdminDataQualityPage } from "../pages/AdminDataQualityPage";
import { AdminOpsDiagnosticsPage } from "../pages/AdminOpsDiagnosticsPage";
import { AdminPermissionsPage } from "../pages/AdminPermissionsPage";
import { AdminPublishApprovalsPage } from "../pages/AdminPublishApprovalsPage";
import { AdminRolesPage } from "../pages/AdminRolesPage";
import { AdminSecurityPolicyPage } from "../pages/AdminSecurityPolicyPage";
import { AdminSetupWizardPage } from "../pages/AdminSetupWizardPage";
import { AdminStoryContextPage } from "../pages/AdminStoryContextPage";
import { AnalyticsDashboardPage } from "../pages/AnalyticsDashboardPage";
import { AuthCallbackPage } from "../pages/AuthCallbackPage";
import { AuthPage } from "../pages/AuthPage";
import { AutomationsPage } from "../pages/AutomationsPage";
import { ChatbotConnectorPage } from "../pages/ChatbotConnectorPage";
import { DashboardPagesPage } from "../pages/DashboardPagesPage";
import { HomePage } from "../pages/HomePage";
import { InviteAcceptPage } from "../pages/InviteAcceptPage";
import { LandingPageEditorPage } from "../pages/LandingPageEditorPage";
import { PlatformOwnerDashboardPage } from "../pages/PlatformOwnerDashboardPage";
import { ProfileCenterPage } from "../pages/ProfileCenterPage";
import { StatusPage } from "../pages/StatusPage";
import { StoryLibraryPage } from "../pages/StoryLibraryPage";
import { TranscriptViewerPage } from "../pages/TranscriptViewerPage";
import { WorkspacesPage } from "../pages/WorkspacesPage";
import { WritebacksPage } from "../pages/WritebacksPage";

interface AuthenticatedRoutesProps {
  user: AuthUser;
}

export function AuthenticatedRoutes({ user }: AuthenticatedRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/accounts" element={<AccountsIndexPage />} />
      <Route path="/stories" element={<StoryLibraryPage userRole={user.role} />} />
      <Route path="/accounts/:accountId" element={<AccountDetailPage userRole={user.role} />} />
      <Route path="/accounts/:accountId/journey" element={<AccountJourneyPage />} />
      <Route path="/pages/:pageId/edit" element={<LandingPageEditorPage />} />
      <Route
        path="/admin/account-access"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminAccountAccessPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/permissions"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminPermissionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminRolesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/story-context"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN", "MEMBER"]} user={user}>
            <AdminStoryContextPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/audit-logs"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminAuditLogsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/ops"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminOpsDiagnosticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/security"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminSecurityPolicyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/governance"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminDataGovernancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/publish-approvals"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminPublishApprovalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/data-quality"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminDataQualityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/setup"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <AdminSetupWizardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/billing"
        element={
          <ProtectedRoute requiredRole={["OWNER"]} user={user}>
            <AdminBillingReadinessPage />
          </ProtectedRoute>
        }
      />
      <Route path="/workspaces" element={<WorkspacesPage userRole={user.role} />} />
      <Route path="/writebacks" element={<WritebacksPage userRole={user.role} />} />
      <Route path="/automations" element={<AutomationsPage userRole={user.role} />} />
      <Route path="/status" element={<StatusPage userOrgId={user.organizationId} />} />
      <Route
        path="/platform"
        element={
          <ProtectedRoute requiredRole={["OWNER"]} user={user} fallback={<AccessDenied />}>
            <PlatformOwnerDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account-settings"
        element={
          <ProtectedRoute requiredRole={["OWNER"]} user={user}>
            <AccountSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="/calls/:callId/transcript" element={<TranscriptViewerPage />} />
      <Route path="/dashboard/pages" element={<DashboardPagesPage userRole={user.role} />} />
      <Route path="/chat" element={<ChatbotConnectorPage />} />
      <Route path="/analytics" element={<AnalyticsDashboardPage />} />
      <Route path="/profile" element={<ProfileCenterPage />} />
      <Route path="/settings/billing" element={<Navigate to="/admin/billing" replace />} />
      <Route path="/setup" element={<Navigate to="/admin/setup" replace />} />
      <Route path="/auth" element={<Navigate to="/" replace />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function PublicRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/auth?mode=login" replace />} />
    </Routes>
  );
}
