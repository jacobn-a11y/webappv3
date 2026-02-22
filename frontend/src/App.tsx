import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <nav className="app-nav">
          <Link to="/" className="app-nav__logo">
            StoryEngine
          </Link>
          <Link to="/" className="app-nav__link">
            Dashboard
          </Link>
          <Link to="/dashboard/pages" className="app-nav__link">
            Pages
          </Link>
          <Link to="/analytics" className="app-nav__link">
            Analytics
          </Link>
          <Link to="/chat" className="app-nav__link">
            Chat
          </Link>
          <Link to="/admin/permissions" className="app-nav__link">
            Admin
          </Link>
          <Link to="/admin/roles" className="app-nav__link">
            Roles
          </Link>
          <Link to="/admin/story-context" className="app-nav__link">
            Story Context
          </Link>
          <Link to="/admin/audit-logs" className="app-nav__link">
            Audit Logs
          </Link>
        </nav>
        <main className="app-content">
          <Routes>
            <Route
              path="/"
              element={<Navigate to="/accounts/acc_meridian" replace />}
            />
            <Route
              path="/accounts/:accountId"
              element={<AccountDetailPage />}
            />
            <Route
              path="/accounts/:accountId/journey"
              element={<AccountJourneyPage />}
            />
            <Route
              path="/pages/:pageId/edit"
              element={<LandingPageEditorPage />}
            />
            <Route
              path="/admin/account-access"
              element={<AdminAccountAccessPage />}
            />
            <Route
              path="/admin/permissions"
              element={<AdminPermissionsPage />}
            />
            <Route
              path="/admin/roles"
              element={<AdminRolesPage />}
            />
            <Route
              path="/admin/story-context"
              element={<AdminStoryContextPage />}
            />
            <Route
              path="/admin/audit-logs"
              element={<AdminAuditLogsPage />}
            />
            <Route
              path="/calls/:callId/transcript"
              element={<TranscriptViewerPage />}
            />
            <Route
              path="/dashboard/pages"
              element={<DashboardPagesPage />}
            />
            <Route
              path="/chat"
              element={<ChatbotConnectorPage />}
            />
            <Route
              path="/analytics"
              element={<AnalyticsDashboardPage />}
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
