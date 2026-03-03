import { describe, expect, it } from "vitest";
import { axe } from "jest-axe";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicApp, Sidebar } from "./App";
import type { NavEntry } from "./app/nav-config";
import { AuthPage } from "./pages/AuthPage";
import { I18nProvider } from "./i18n";

function TestIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" />
    </svg>
  );
}

const nav: NavEntry[] = [
  { to: "/", label: "Home", icon: TestIcon },
  {
    label: "Administration",
    icon: TestIcon,
    items: [{ to: "/admin/setup", label: "Setup", icon: TestIcon }],
  },
];

describe("accessibility", () => {
  it("sidebar has no critical axe violations", async () => {
    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/admin/setup"]}>
          <Sidebar
            nav={nav}
            user={{
              id: "usr_1",
              email: "admin@example.com",
              name: "Admin User",
              organizationId: "org_1",
              role: "ADMIN",
            }}
            collapsed={false}
            theme="dark"
            highContrast={false}
            onToggleCollapse={() => {}}
            onToggleTheme={() => {}}
            onToggleHighContrast={() => {}}
            onLogout={() => {}}
          />
        </MemoryRouter>
      </I18nProvider>
    );

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });

  it("auth page has no critical axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/auth?mode=login"]}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
        </Routes>
      </MemoryRouter>
    );

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });

  it("public app wrapper has landmarks and route-focus behavior", async () => {
    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/auth?mode=login"]}>
          <PublicApp />
        </MemoryRouter>
      </I18nProvider>
    );

    const heading = await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
    expect(document.activeElement).toBe(heading);
    expect(container.querySelector("main#public-main-content")).toBeTruthy();

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
