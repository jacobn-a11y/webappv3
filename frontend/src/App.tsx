import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { LandingPageEditorPage } from "./pages/LandingPageEditorPage";

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
        </nav>
        <main className="app-content">
          <Routes>
            <Route
              path="/"
              element={<Navigate to="/accounts/demo-account" replace />}
            />
            <Route
              path="/accounts/:accountId"
              element={<AccountDetailPage />}
            />
            <Route
              path="/pages/:pageId/edit"
              element={<LandingPageEditorPage />}
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
