import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Breadcrumb } from "../components/Breadcrumb";
import {
  getChatAccounts,
  getStoryLibrary,
  getRoleAwareHome,
  type ChatAccount,
  type StoryLibraryItem,
  type RoleAwareHome,
  type AuthUser,
} from "../lib/api";
import {
  buildNav,
  IconMenu,
} from "./nav-config";
import { AuthenticatedRoutes } from "./routes";
import {
  CommandPaletteModal,
  StoryPickerModal,
} from "./global-modals";
import { useI18n } from "../i18n";
import {
  Sidebar,
  COLLAPSE_KEY,
  FOCUSABLE_SELECTOR,
  trapDialogFocus,
  ensureAccessibleFormLabels,
} from "./Sidebar";
import { useTheme } from "./ThemeProvider";
import {
  buildAppBreadcrumbItems,
  buildQuickNavMatches,
} from "./shell-navigation";

export function Shell({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { theme, highContrast, toggleTheme, toggleHighContrast } = useTheme();
  const [persona, setPersona] = useState<RoleAwareHome["persona"] | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [storyPickerSearch, setStoryPickerSearch] = useState("");
  const [storyPickerAccounts, setStoryPickerAccounts] = useState<ChatAccount[]>([]);
  const [storyPickerLoading, setStoryPickerLoading] = useState(false);
  const [storyPickerError, setStoryPickerError] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandAccounts, setCommandAccounts] = useState<ChatAccount[]>([]);
  const [commandStories, setCommandStories] = useState<StoryLibraryItem[]>([]);
  const [commandLoading, setCommandLoading] = useState(false);
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  const [commandAnnouncement, setCommandAnnouncement] = useState("");
  const mainRef = useRef<HTMLElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const storyPickerDialogRef = useRef<HTMLDivElement | null>(null);
  const commandDialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const shouldRestoreMobileFocusRef = useRef(false);

  useEffect(() => {
    getRoleAwareHome()
      .then((res) => setPersona(res.persona))
      .catch(() => setPersona(null));
  }, []);

  useEffect(() => {
    if (!storyPickerOpen || user.role === "VIEWER") return;
    let cancelled = false;
    setStoryPickerLoading(true);
    setStoryPickerError(null);
    const timeout = window.setTimeout(() => {
      void getChatAccounts(storyPickerSearch.trim() || undefined)
        .then((res) => {
          if (cancelled) return;
          setStoryPickerAccounts(res.accounts);
        })
        .catch((err) => {
          if (cancelled) return;
          setStoryPickerError(
            err instanceof Error ? err.message : "Failed to load accounts"
          );
          setStoryPickerAccounts([]);
        })
        .finally(() => {
          if (!cancelled) {
            setStoryPickerLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [storyPickerOpen, storyPickerSearch, user.role]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        previousFocusRef.current = document.activeElement as HTMLElement | null;
        setCommandOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    const timeout = window.setTimeout(() => {
      commandInputRef.current?.focus();
      commandInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [commandOpen]);

  useEffect(() => {
    if (!storyPickerOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timeout = window.setTimeout(() => {
      const firstFocusable = storyPickerDialogRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTOR
      );
      firstFocusable?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storyPickerOpen]);

  useEffect(() => {
    const container = storyPickerDialogRef.current;
    if (!storyPickerOpen || !container) return;
    const onKeydown = (event: KeyboardEvent) =>
      trapDialogFocus(event, container, () => setStoryPickerOpen(false));
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [storyPickerOpen]);

  useEffect(() => {
    const container = commandDialogRef.current;
    if (!commandOpen || !container) return;
    const onKeydown = (event: KeyboardEvent) =>
      trapDialogFocus(event, container, () => setCommandOpen(false));
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [commandOpen]);

  useEffect(() => {
    if (storyPickerOpen || commandOpen) return;
    previousFocusRef.current?.focus();
  }, [storyPickerOpen, commandOpen]);

  useEffect(() => {
    if (!mobileOpen) {
      if (shouldRestoreMobileFocusRef.current) {
        window.setTimeout(() => {
          mobileMenuButtonRef.current?.focus();
        }, 0);
      }
      shouldRestoreMobileFocusRef.current = false;
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        shouldRestoreMobileFocusRef.current = true;
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const nav = useMemo(() => buildNav(persona, user.role, t), [persona, t, user.role]);
  const appBreadcrumbItems = useMemo(
    () => buildAppBreadcrumbItems(location.pathname),
    [location.pathname]
  );

  const quickNavMatches = useMemo(
    () => buildQuickNavMatches(nav, commandQuery),
    [commandQuery, nav]
  );

  useEffect(() => {
    shouldRestoreMobileFocusRef.current = false;
    setMobileOpen(false);
    setCommandOpen(false);
    const heading = document.querySelector("main h1");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
      setRouteAnnouncement(`Navigated to ${heading.textContent ?? "page"}.`);
      return;
    }
    mainRef.current?.focus();
    setRouteAnnouncement("Navigated to page.");
  }, [location.pathname]);

  useEffect(() => {
    if (!mainRef.current) return;
    ensureAccessibleFormLabels(mainRef.current);
  }, [location.pathname, storyPickerOpen, commandOpen]);

  useEffect(() => {
    if (!commandOpen) return;
    const query = commandQuery.trim();
    if (query.length < 2) {
      setCommandAccounts([]);
      setCommandStories([]);
      setCommandLoading(false);
      setCommandAnnouncement("Enter at least 2 characters for search results.");
      return;
    }

    let cancelled = false;
    setCommandLoading(true);
    const timeout = window.setTimeout(() => {
      void Promise.all([
        getChatAccounts(query),
        getStoryLibrary({ search: query, page: 1, limit: 6 }),
      ])
        .then(([accounts, stories]) => {
          if (cancelled) return;
          setCommandAccounts(accounts.accounts.slice(0, 6));
          setCommandStories(stories.stories.slice(0, 6));
          const totalResults =
            quickNavMatches.length +
            Math.min(accounts.accounts.length, 6) +
            Math.min(stories.stories.length, 6);
          setCommandAnnouncement(
            totalResults > 0
              ? `${totalResults} search results available.`
              : "No search results."
          );
        })
        .catch(() => {
          if (cancelled) return;
          setCommandAccounts([]);
          setCommandStories([]);
          setCommandAnnouncement("Search failed. Try again.");
        })
        .finally(() => {
          if (!cancelled) setCommandLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [commandOpen, commandQuery, quickNavMatches.length]);

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

  const openStoryPicker = useCallback(() => {
    if (user.role === "VIEWER") return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setStoryPickerOpen(true);
    setStoryPickerSearch("");
    setStoryPickerError(null);
  }, [user.role]);

  const openCommandPalette = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setCommandOpen(true);
  }, []);

  const openMobileNav = useCallback(() => {
    shouldRestoreMobileFocusRef.current = true;
    setMobileOpen(true);
  }, []);

  const closeMobileNav = useCallback((restoreFocus = true) => {
    shouldRestoreMobileFocusRef.current = restoreFocus;
    setMobileOpen(false);
  }, []);

  const closeStoryPicker = useCallback(() => {
    setStoryPickerOpen(false);
  }, []);

  const handleSelectStoryAccount = useCallback(
    (accountId: string) => {
      setStoryPickerOpen(false);
      setStoryPickerSearch("");
      navigate(`/accounts/${accountId}?newStory=1`);
    },
    [navigate]
  );

  const handleCommandNavigate = useCallback(
    (to: string) => {
      setCommandOpen(false);
      setCommandQuery("");
      navigate(to);
    },
    [navigate]
  );

  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`}>
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      <header className="mobile-header">
        <button
          ref={mobileMenuButtonRef}
          type="button"
          className="mobile-header__hamburger"
          onClick={openMobileNav}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <IconMenu />
        </button>
        <Link to="/" className="mobile-header__logo">{t("app.brand", "StoryEngine")}</Link>
        <button
          type="button"
          className="mobile-header__new-story"
          onClick={openCommandPalette}
          aria-label="Open global search"
        >
          Search
        </button>
        {user.role !== "VIEWER" && (
          <button
            type="button"
            className="mobile-header__new-story"
            onClick={openStoryPicker}
          >
            New Story
          </button>
        )}
      </header>

      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => closeMobileNav(true)} />
      )}

      <Sidebar
        nav={nav}
        user={user}
        collapsed={collapsed}
        theme={theme}
        highContrast={highContrast}
        onToggleCollapse={toggleCollapse}
        onToggleTheme={toggleTheme}
        onToggleHighContrast={toggleHighContrast}
        onLogout={handleLogout}
        onClose={mobileOpen ? () => closeMobileNav(false) : undefined}
      />

      <StoryPickerModal
        open={storyPickerOpen}
        dialogRef={storyPickerDialogRef}
        search={storyPickerSearch}
        onSearchChange={setStoryPickerSearch}
        loading={storyPickerLoading}
        error={storyPickerError}
        accounts={storyPickerAccounts}
        onClose={closeStoryPicker}
        onSelectAccount={handleSelectStoryAccount}
      />

      <CommandPaletteModal
        open={commandOpen}
        dialogRef={commandDialogRef}
        inputRef={commandInputRef}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        quickNavMatches={quickNavMatches}
        accounts={commandAccounts}
        stories={commandStories}
        loading={commandLoading}
        onClose={() => setCommandOpen(false)}
        onNavigate={handleCommandNavigate}
      />

      <div className="sr-only" role="status" aria-live="polite">
        {routeAnnouncement}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {commandAnnouncement}
      </div>
      <main className="app-content" id="main-content" ref={mainRef} tabIndex={-1}>
        {user.role !== "VIEWER" && (
          <div className="app-topbar">
            <button type="button" className="btn btn--ghost" onClick={openCommandPalette}>
              Search
            </button>
            <button type="button" className="btn btn--primary" onClick={openStoryPicker}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M8 2v12M2 8h12" />
              </svg>
              New Story
            </button>
          </div>
        )}
        {appBreadcrumbItems && <Breadcrumb items={appBreadcrumbItems} />}
        <ErrorBoundary>
          <AuthenticatedRoutes user={user} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
