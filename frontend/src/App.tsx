import { BrowserRouter, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { Shell } from "./app/Shell";
import { ensureAccessibleFormLabels } from "./app/Sidebar";
import { PublicRoutes } from "./app/routes";
import { useAuth } from "./hooks/useAuth";
import { useI18n } from "./i18n";

// Re-export for backward compatibility (used by tests)
export { Sidebar } from "./app/Sidebar";

// ─── Public App ────────────────────────────────────────────────────────────────

export function PublicApp() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const [routeAnnouncement, setRouteAnnouncement] = useState("");

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const heading = main.querySelector("h1");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
      setRouteAnnouncement(`Navigated to ${heading.textContent ?? "page"}.`);
      return;
    }
    main.focus();
    setRouteAnnouncement("Navigated to page.");
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mainRef.current) return;
    ensureAccessibleFormLabels(mainRef.current);
  }, [location.pathname, location.search]);

  return (
    <>
      <a href="#public-main-content" className="skip-to-content">Skip to main content</a>
      <div className="sr-only" role="status" aria-live="polite">
        {routeAnnouncement}
      </div>
      <main id="public-main-content" ref={mainRef} tabIndex={-1}>
        <ErrorBoundary>
          <PublicRoutes />
        </ErrorBoundary>
      </main>
    </>
  );
}

// ─── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { user, loading, handleLogout } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="auth-page" role="status" aria-live="polite">
        <div className="auth-card">
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <h1 className="auth-card__title" style={{ textAlign: "center" }}>
            {t("app.loading_workspace", "Loading workspace")}
          </h1>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ToastProvider>
        {user ? <Shell user={user} onLogout={handleLogout} /> : <PublicApp />}
      </ToastProvider>
    </BrowserRouter>
  );
}
