import { Link, useLocation } from "react-router-dom";
import { useCallback, useState } from "react";
import {
  IconChevron,
  IconCollapse,
  IconExpand,
  IconLogout,
  isGroup,
  type NavEntry,
} from "./nav-config";
import { useI18n } from "../i18n";
import type { AuthUser } from "../lib/api";

export type ThemePreference = "dark" | "light";

export const COLLAPSE_KEY = "sidebar_collapsed";
export const GROUPS_KEY = "sidebar_groups";
export const CONTRAST_KEY = "a11y_high_contrast";
export const THEME_KEY = "ui_theme";

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function trapDialogFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  onClose?: () => void
) {
  if (event.key === "Escape") {
    onClose?.();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => !el.hasAttribute("disabled"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ensureAccessibleFormLabels(container: ParentNode) {
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
