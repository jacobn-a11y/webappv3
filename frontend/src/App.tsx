import { BrowserRouter, Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { Breadcrumb } from "./components/Breadcrumb";
import {
  clearAuthState,
  getAuthMe,
  getChatAccounts,
  getStoryLibrary,
  getRoleAwareHome,
  getStoredAuthUser,
  logoutSelfService,
  subscribeAuthChanges,
  type ChatAccount,
  type StoryLibraryItem,
  type RoleAwareHome,
  type AuthUser,
} from "./lib/api";
import {
  buildNav,
  IconChevron,
  IconCollapse,
  IconExpand,
  IconLogout,
  IconMenu,
  isGroup,
  type NavEntry,
} from "./app/nav-config";
import { AuthenticatedRoutes, PublicRoutes } from "./app/routes";
import {
  CommandPaletteModal,
  StoryPickerModal,
} from "./app/global-modals";
import { useI18n } from "./i18n";
import { FOCUSABLE_SELECTOR, trapDialogFocus } from "./lib/focus";

// ─── Sidebar Component ────────────────────────────────────────────────────────

const COLLAPSE_KEY = "sidebar_collapsed";
const GROUPS_KEY = "sidebar_groups";
const CONTRAST_KEY = "a11y_high_contrast";
const THEME_KEY = "ui_theme";
type ThemePreference = "dark" | "light";

function ensureAccessibleFormLabels(container: ParentNode) {
  const controls = container.querySelectorAll<HTMLElement>("input, select, textarea");
  controls.forEach((control, index) => {
    if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) {
      return;
    }

    const wrapperLabel = control.closest("label");
    if (wrapperLabel instanceof HTMLLabelElement) {
      if (wrapperLabel.contains(control)) return;
      const controlId = control.id || `a11y-field-${index + 1}`;
      control.id = controlId;
      if (!wrapperLabel.htmlFor) {
        wrapperLabel.htmlFor = controlId;
      }
      return;
    }

    const parent = control.parentElement;
    const siblingLabel =
      parent?.querySelector<HTMLElement>("label, .form-group__label") ??
      control
        .closest(".form-group, .form-row")
        ?.querySelector<HTMLElement>("label, .form-group__label");
    if (siblingLabel) {
      if (siblingLabel instanceof HTMLLabelElement) {
        const controlId = control.id || `a11y-field-${index + 1}`;
        control.id = controlId;
        if (!siblingLabel.htmlFor) {
          siblingLabel.htmlFor = controlId;
        }
      } else {
        const labelId = siblingLabel.id || `a11y-label-${index + 1}`;
        siblingLabel.id = labelId;
        control.setAttribute("aria-labelledby", labelId);
      }
      return;
    }

    const placeholder = control.getAttribute("placeholder")?.trim();
    const fallback = placeholder && placeholder.length > 0 ? placeholder : `Field ${index + 1}`;
    control.setAttribute("aria-label", fallback);
  });
}

export function Sidebar({
  nav,
  user,
  collapsed,
  theme,
  highContrast,
  onToggleCollapse,
  onToggleTheme,
  onToggleHighContrast,
  onLogout,
  onClose,
}: {
  nav: NavEntry[];
  user: AuthUser;
  collapsed: boolean;
  theme: ThemePreference;
  highContrast: boolean;
  onToggleCollapse: () => void;
  onToggleTheme: () => void;
  onToggleHighContrast: () => void;
  onLogout: () => void;
  onClose?: () => void;
}) {
  const location = useLocation();
  const { t } = useI18n();

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
    <aside
      className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}
      aria-label={t("app.nav.main", "Main navigation")}
    >
      {/* Logo + Mobile Close */}
      <div className="sidebar__top">
        <Link to="/" className="sidebar__logo" onClick={onClose}>
          <span className="sidebar__logo-text">{t("app.brand", "StoryEngine")}</span>
        </Link>
        {onClose && (
          <button type="button" className="sidebar__close-btn" onClick={onClose} aria-label="Close navigation">
            <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav" aria-label={t("app.nav.primary", "Primary")}>
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
                  aria-label={collapsed ? entry.label : undefined}
                  title={collapsed ? entry.label : undefined}
                >
                  <span className="sidebar__link-icon" aria-hidden="true"><entry.icon /></span>
                  <span className="sidebar__link-label">{entry.label}</span>
                  <span
                    className={`sidebar__group-chevron${isOpen ? " sidebar__group-chevron--open" : ""}`}
                    aria-hidden="true"
                  >
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
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      onClick={onClose}
                    >
                      <span className="sidebar__link-icon" aria-hidden="true"><item.icon /></span>
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
              aria-label={collapsed ? entry.label : undefined}
              title={collapsed ? entry.label : undefined}
              onClick={onClose}
            >
              <span className="sidebar__link-icon" aria-hidden="true"><entry.icon /></span>
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
          <button
            className="btn btn--ghost btn--sm"
            onClick={onLogout}
            title={t("app.nav.logout", "Logout")}
            aria-label={t("app.nav.logout", "Logout")}
            style={{ padding: "4px 6px", marginLeft: "auto" }}
          >
            <IconLogout />
          </button>
        </div>
        <button
          type="button"
          className="sidebar__mode-btn"
          onClick={onToggleTheme}
          aria-label={
            theme === "dark"
              ? t("app.nav.theme_to_light", "Switch to light theme")
              : t("app.nav.theme_to_dark", "Switch to dark theme")
          }
        >
          {theme === "dark"
            ? t("app.nav.theme_light", "Light Theme")
            : t("app.nav.theme_dark", "Dark Theme")}
        </button>
        <button
          type="button"
          className="sidebar__contrast-btn"
          onClick={onToggleHighContrast}
          aria-pressed={highContrast}
          aria-label={
            highContrast
              ? t("app.nav.contrast_disable", "Disable high contrast mode")
              : t("app.nav.contrast_enable", "Enable high contrast mode")
          }
        >
          {highContrast ? "Standard Contrast" : "High Contrast"}
        </button>
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const [persona, setPersona] = useState<RoleAwareHome["persona"] | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { return false; }
  });
  const [highContrast, setHighContrast] = useState(() => {
    try { return localStorage.getItem(CONTRAST_KEY) === "true"; } catch { return false; }
  });
  const [theme, setTheme] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "light" || stored === "dark" ? stored : "dark";
    } catch {
      return "dark";
    }
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
    document.documentElement.classList.toggle("theme-high-contrast", highContrast);
    document.documentElement.lang = "en";
    try {
      localStorage.setItem(CONTRAST_KEY, String(highContrast));
    } catch {
      // Ignore storage failures in restricted environments.
    }
    return () => {
      document.documentElement.classList.remove("theme-high-contrast");
    };
  }, [highContrast]);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage failures in restricted environments.
    }
    return () => {
      document.documentElement.classList.remove("theme-light");
    };
  }, [theme]);

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
  const appBreadcrumbItems = useMemo(() => {
    const path = location.pathname;
    if (path === "/") return null;
    if (/^\/accounts\/[^/]+(\/journey)?$/.test(path)) return null;
    if (/^\/pages\/[^/]+\/edit$/.test(path)) return null;

    const labelMap: Record<string, string> = {
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
      setup: "Setup",
      billing: "Billing",
      accounts: "Accounts",
      stories: "Stories",
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

    const segments = path.split("/").filter(Boolean);
    let builtPath = "";
    const items: Array<{ label: string; to?: string }> = [{ label: "Home", to: "/" }];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? "";
      builtPath += `/${segment}`;
      const isLast = index === segments.length - 1;
      const isLikelyId = /^[a-z0-9-]{10,}$/i.test(segment);
      const label = isLikelyId ? "Details" : (labelMap[segment] ?? segment);
      items.push({
        label,
        to: isLast ? undefined : builtPath,
      });
    }

    return items;
  }, [location.pathname]);

  const quickNavMatches = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();
    if (!normalized) return [] as Array<{ to: string; label: string }>;
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
  }, [commandQuery, nav]);

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

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
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

      {/* Mobile header */}
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

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => closeMobileNav(true)} />
      )}

      {/* Sidebar */}
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

      {/* Main content */}
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
        <PublicRoutes />
      </main>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getStoredAuthUser());
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

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
        {user ? <AuthenticatedApp user={user} onLogout={handleLogout} /> : <PublicApp />}
      </ToastProvider>
    </BrowserRouter>
  );
}
