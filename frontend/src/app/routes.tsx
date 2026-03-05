import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../lib/api";
import { ProtectedRoute, AccessDenied } from "../components/ProtectedRoute";
import { PageSkeleton } from "../components/PageSkeleton";

const AccountDetailPage = lazy(() => import("../pages/AccountDetailPage").then(m => ({ default: m.AccountDetailPage })));
const AccountsIndexPage = lazy(() => import("../pages/AccountsIndexPage").then(m => ({ default: m.AccountsIndexPage })));
const AccountJourneyPage = lazy(() => import("../pages/AccountJourneyPage").then(m => ({ default: m.AccountJourneyPage })));
const AccountSettingsPage = lazy(() => import("../pages/AccountSettingsPage").then(m => ({ default: m.AccountSettingsPage })));
const AdminAccountAccessPage = lazy(() => import("../pages/AdminAccountAccessPage").then(m => ({ default: m.AdminAccountAccessPage })));
const AdminBillingReadinessPage = lazy(() => import("../pages/AdminBillingReadinessPage").then(m => ({ default: m.AdminBillingReadinessPage })));
const AdminPermissionsPage = lazy(() => import("../pages/AdminPermissionsPage").then(m => ({ default: m.AdminPermissionsPage })));
const AdminPublishApprovalsPage = lazy(() => import("../pages/AdminPublishApprovalsPage").then(m => ({ default: m.AdminPublishApprovalsPage })));
const AdminRolesPage = lazy(() => import("../pages/AdminRolesPage").then(m => ({ default: m.AdminRolesPage })));
const AdminSetupWizardPage = lazy(() => import("../pages/AdminSetupWizardPage").then(m => ({ default: m.AdminSetupWizardPage })));
const IntegrationsSettingsPage = lazy(() => import("../pages/IntegrationsSettingsPage").then(m => ({ default: m.IntegrationsSettingsPage })));
const AdminStoryContextPage = lazy(() => import("../pages/AdminStoryContextPage").then(m => ({ default: m.AdminStoryContextPage })));
const AuthCallbackPage = lazy(() => import("../pages/AuthCallbackPage").then(m => ({ default: m.AuthCallbackPage })));
const AuthPage = lazy(() => import("../pages/AuthPage").then(m => ({ default: m.AuthPage })));
const ChatbotConnectorPage = lazy(() => import("../pages/ChatbotConnectorPage").then(m => ({ default: m.ChatbotConnectorPage })));
const ContentQueuePage = lazy(() => import("../pages/ContentQueuePage").then(m => ({ default: m.ContentQueuePage })));
const DashboardPagesPage = lazy(() => import("../pages/DashboardPagesPage").then(m => ({ default: m.DashboardPagesPage })));
const HomePage = lazy(() => import("../pages/HomePage").then(m => ({ default: m.HomePage })));
const InviteAcceptPage = lazy(() => import("../pages/InviteAcceptPage").then(m => ({ default: m.InviteAcceptPage })));
const LandingPageEditorPage = lazy(() => import("../pages/LandingPageEditorPage").then(m => ({ default: m.LandingPageEditorPage })));
const PlatformOwnerDashboardPage = lazy(() => import("../pages/PlatformOwnerDashboardPage").then(m => ({ default: m.PlatformOwnerDashboardPage })));
const ProfileCenterPage = lazy(() => import("../pages/ProfileCenterPage").then(m => ({ default: m.ProfileCenterPage })));
const StatusPage = lazy(() => import("../pages/StatusPage").then(m => ({ default: m.StatusPage })));
const StoryLibraryPage = lazy(() => import("../pages/StoryLibraryPage").then(m => ({ default: m.StoryLibraryPage })));
const TaxonomyBrowserPage = lazy(() => import("../pages/TaxonomyBrowserPage").then(m => ({ default: m.TaxonomyBrowserPage })));
const MyQueuePage = lazy(() => import("../pages/MyQueuePage").then(m => ({ default: m.MyQueuePage })));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage").then(m => ({ default: m.NotFoundPage })));

interface AuthenticatedRoutesProps {
  user: AuthUser;
}

export function AuthenticatedRoutes({ user }: AuthenticatedRoutesProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/accounts" element={<AccountsIndexPage />} />
      <Route path="/stories" element={<StoryLibraryPage userRole={user.role} />} />
      <Route path="/taxonomy" element={<TaxonomyBrowserPage />} />
      <Route path="/content-queue" element={<ContentQueuePage />} />
      <Route path="/my-queue" element={<MyQueuePage />} />
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
        path="/admin/publish-approvals"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN", "MEMBER", "VIEWER"]} user={user}>
            <AdminPublishApprovalsPage />
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
        path="/admin/settings/integrations"
        element={
          <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user}>
            <IntegrationsSettingsPage />
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
      <Route path="/dashboard/pages" element={<DashboardPagesPage userRole={user.role} />} />
      <Route path="/chat" element={<ChatbotConnectorPage />} />
      <Route path="/profile" element={<ProfileCenterPage />} />
      <Route path="/settings/billing" element={<Navigate to="/admin/billing" replace />} />
      <Route path="/settings/integrations" element={<Navigate to="/admin/settings/integrations" replace />} />
      <Route path="/setup" element={<Navigate to="/admin/setup" replace />} />
      <Route path="/auth" element={<Navigate to="/" replace />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  );
}

export function PublicRoutes() {
  return (
    <Suspense fallback={<PageSkeleton />}>
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/auth?mode=login" replace />} />
    </Routes>
    </Suspense>
  );
}
