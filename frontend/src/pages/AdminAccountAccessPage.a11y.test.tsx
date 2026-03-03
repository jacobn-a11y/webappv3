import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { render, screen } from "@testing-library/react";
import { AdminAccountAccessPage } from "./AdminAccountAccessPage";

const getAccessUsersMock = vi.fn();
const searchAccountsMock = vi.fn();
const grantAccessMock = vi.fn();
const revokeAccessMock = vi.fn();
const syncAccessGrantMock = vi.fn();
const getCrmReportsMock = vi.fn();

vi.mock("../lib/api", () => ({
  getAccessUsers: (...args: unknown[]) => getAccessUsersMock(...args),
  searchAccounts: (...args: unknown[]) => searchAccountsMock(...args),
  grantAccess: (...args: unknown[]) => grantAccessMock(...args),
  revokeAccess: (...args: unknown[]) => revokeAccessMock(...args),
  syncAccessGrant: (...args: unknown[]) => syncAccessGrantMock(...args),
  getCrmReports: (...args: unknown[]) => getCrmReportsMock(...args),
}));

describe("AdminAccountAccessPage accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessUsersMock.mockResolvedValue({ users: [] });
    searchAccountsMock.mockResolvedValue({ accounts: [] });
    grantAccessMock.mockResolvedValue({ granted: true });
    revokeAccessMock.mockResolvedValue({ revoked: true });
    syncAccessGrantMock.mockResolvedValue({ synced: true });
    getCrmReportsMock.mockResolvedValue({ reports: [] });
  });

  it("has no critical axe violations in empty state", async () => {
    const { container } = render(<AdminAccountAccessPage />);
    await screen.findByText("No users found.");

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
