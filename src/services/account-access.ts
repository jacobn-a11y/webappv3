/**
 * Account Access Control Service
 *
 * Controls which accounts a user can generate landing pages for.
 * Access can be:
 *   - ALL_ACCOUNTS: unrestricted (default for OWNER/ADMIN)
 *   - SINGLE_ACCOUNT: one specific CRM account
 *   - ACCOUNT_LIST: a manually curated set of account IDs
 *   - CRM_REPORT: a Salesforce report or HubSpot list that defines the set
 *
 * For CRM_REPORT scoping, the service periodically syncs the report contents
 * and caches the resolved account IDs locally.
 */

import type { PrismaClient, AccountScopeType, CRMProvider, UserRole } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountAccessGrant {
  userId: string;
  organizationId: string;
  scopeType: AccountScopeType;
  accountId?: string;
  accountIds?: string[];
  crmReportId?: string;
  crmProvider?: CRMProvider;
  crmReportName?: string;
  grantedById: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AccountAccessService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Checks if a user has access to a specific account for landing page operations.
   * OWNER/ADMIN always have access to all accounts.
   */
  async canAccessAccount(
    userId: string,
    organizationId: string,
    accountId: string,
    userRole?: UserRole
  ): Promise<boolean> {
    // Admins always have full access
    if (userRole === "OWNER" || userRole === "ADMIN") return true;

    const grants = await this.prisma.userAccountAccess.findMany({
      where: { userId, organizationId },
    });

    // If no grants exist, user has no account-level access
    if (grants.length === 0) return false;

    for (const grant of grants) {
      switch (grant.scopeType) {
        case "ALL_ACCOUNTS":
          return true;

        case "SINGLE_ACCOUNT":
          if (grant.accountId === accountId) return true;
          break;

        case "ACCOUNT_LIST":
        case "CRM_REPORT":
          if (grant.cachedAccountIds.includes(accountId)) return true;
          break;
      }
    }

    return false;
  }

  /**
   * Returns all account IDs a user has access to.
   * For OWNER/ADMIN, returns null (meaning "all").
   */
  async getAccessibleAccountIds(
    userId: string,
    organizationId: string,
    userRole?: UserRole
  ): Promise<string[] | null> {
    if (userRole === "OWNER" || userRole === "ADMIN") return null; // all

    const grants = await this.prisma.userAccountAccess.findMany({
      where: { userId, organizationId },
    });

    if (grants.length === 0) return [];

    const accountIds = new Set<string>();

    for (const grant of grants) {
      switch (grant.scopeType) {
        case "ALL_ACCOUNTS":
          return null; // all

        case "SINGLE_ACCOUNT":
          if (grant.accountId) accountIds.add(grant.accountId);
          break;

        case "ACCOUNT_LIST":
        case "CRM_REPORT":
          for (const id of grant.cachedAccountIds) {
            accountIds.add(id);
          }
          break;
      }
    }

    return Array.from(accountIds);
  }

  /**
   * Grants account access to a user.
   */
  async grantAccess(input: AccountAccessGrant): Promise<string> {
    const data: Record<string, unknown> = {
      userId: input.userId,
      organizationId: input.organizationId,
      scopeType: input.scopeType,
      grantedById: input.grantedById,
    };

    if (input.scopeType === "SINGLE_ACCOUNT" && input.accountId) {
      data.accountId = input.accountId;
    }

    if (input.scopeType === "ACCOUNT_LIST" && input.accountIds) {
      data.cachedAccountIds = input.accountIds;
    }

    if (input.scopeType === "CRM_REPORT") {
      data.crmReportId = input.crmReportId;
      data.crmProvider = input.crmProvider;
      data.crmReportName = input.crmReportName;
      // Cached IDs will be populated on first sync
      data.cachedAccountIds = [];
    }

    const grant = await this.prisma.userAccountAccess.create({
      data: data as Parameters<typeof this.prisma.userAccountAccess.create>[0]["data"],
    });

    return grant.id;
  }

  /**
   * Revokes a specific access grant.
   */
  async revokeAccess(grantId: string): Promise<void> {
    await this.prisma.userAccountAccess.delete({
      where: { id: grantId },
    });
  }

  /**
   * Lists all access grants for a user.
   */
  async listUserAccess(userId: string, organizationId: string) {
    return this.prisma.userAccountAccess.findMany({
      where: { userId, organizationId },
      include: {
        account: { select: { id: true, name: true, domain: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Syncs a CRM_REPORT grant by fetching the report contents from
   * Salesforce/HubSpot via Merge.dev and updating the cached account IDs.
   *
   * This is called on a schedule (e.g., daily) or when an admin triggers
   * a manual refresh.
   */
  async syncCrmReportGrant(grantId: string): Promise<{ accountCount: number }> {
    const grant = await this.prisma.userAccountAccess.findUniqueOrThrow({
      where: { id: grantId },
    });

    if (grant.scopeType !== "CRM_REPORT" || !grant.crmReportId) {
      throw new Error("Grant is not a CRM_REPORT type");
    }

    // Fetch account IDs from the CRM report.
    // In production, this calls the Merge.dev API to resolve the report.
    // The implementation depends on whether it's a Salesforce report or HubSpot list.
    const accountIds = await this.fetchCrmReportAccountIds(
      grant.organizationId,
      grant.crmProvider!,
      grant.crmReportId
    );

    // Match CRM IDs to our local account records
    const matchedAccounts = await this.matchCrmIdsToAccounts(
      grant.organizationId,
      grant.crmProvider!,
      accountIds
    );

    await this.prisma.userAccountAccess.update({
      where: { id: grantId },
      data: {
        cachedAccountIds: matchedAccounts,
        lastSyncedAt: new Date(),
      },
    });

    return { accountCount: matchedAccounts.length };
  }

  /**
   * Syncs all CRM_REPORT grants for an organization.
   */
  async syncAllCrmReports(organizationId: string): Promise<void> {
    const grants = await this.prisma.userAccountAccess.findMany({
      where: { organizationId, scopeType: "CRM_REPORT" },
    });

    for (const grant of grants) {
      try {
        await this.syncCrmReportGrant(grant.id);
      } catch (err) {
        console.error(`Failed to sync CRM report grant ${grant.id}:`, err);
      }
    }
  }

  /**
   * Lists all users in an organization with their account access grants.
   * Returns each user with role info and their resolved access grants.
   */
  async listAllUserAccess(organizationId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        accountAccess: {
          include: {
            account: { select: { id: true, name: true, domain: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ role: "asc" }, { email: "asc" }],
    });

    return users;
  }

  /**
   * Searches accounts by name or domain for the account picker.
   */
  async searchAccounts(
    organizationId: string,
    query: string,
    limit = 20
  ) {
    return this.prisma.account.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { domain: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, domain: true },
      take: limit,
      orderBy: { name: "asc" },
    });
  }

  /**
   * Fetches available CRM reports/lists from Salesforce or HubSpot
   * via Merge.dev passthrough API.
   *
   * Returns a list of { id, name } objects representing reports or lists.
   */
  async fetchAvailableCrmReports(
    organizationId: string,
    provider: CRMProvider
  ): Promise<Array<{ id: string; name: string }>> {
    // In production this calls Merge.dev passthrough API:
    //
    // Salesforce:
    //   POST /api/v1/passthrough
    //   { method: "GET", path: "/analytics/reports" }
    //   Returns list of Salesforce reports
    //
    // HubSpot:
    //   POST /api/v1/passthrough
    //   { method: "GET", path: "/contacts/v1/lists" }
    //   Returns list of HubSpot static/dynamic lists
    //
    // For now, fetch from the Merge.dev linked account for this org.

    const mergeApiKey = process.env.MERGE_API_KEY ?? "";
    const mergeAccountToken = await this.getMergeAccountToken(organizationId);

    if (!mergeApiKey || !mergeAccountToken) {
      return [];
    }

    try {
      if (provider === "SALESFORCE") {
        const response = await fetch("https://api.merge.dev/api/crm/v1/passthrough", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mergeApiKey}`,
            "X-Account-Token": mergeAccountToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            method: "GET",
            path: "/services/data/v59.0/analytics/reports",
          }),
        });

        if (!response.ok) return [];

        const data = await response.json() as Array<{ id: string; name: string }>;
        return (data ?? []).map((r: { id: string; name: string }) => ({
          id: r.id,
          name: r.name,
        }));
      }

      if (provider === "HUBSPOT") {
        const response = await fetch("https://api.merge.dev/api/crm/v1/passthrough", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mergeApiKey}`,
            "X-Account-Token": mergeAccountToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            method: "GET",
            path: "/contacts/v1/lists",
          }),
        });

        if (!response.ok) return [];

        const data = await response.json() as { lists?: Array<{ listId: number; name: string }> };
        return (data.lists ?? []).map((l: { listId: number; name: string }) => ({
          id: String(l.listId),
          name: l.name,
        }));
      }

      return [];
    } catch (err) {
      console.error(`Failed to fetch CRM reports for ${provider}:`, err);
      return [];
    }
  }

  /**
   * Retrieves the Merge.dev account token for an organization.
   */
  private async getMergeAccountToken(
    organizationId: string
  ): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { mergeAccountToken: true },
    });

    return (org as { mergeAccountToken?: string | null })?.mergeAccountToken ?? null;
  }

  // ─── Private: CRM Integration ──────────────────────────────────────

  /**
   * Fetches account/company IDs from a CRM report or list.
   *
   * For Salesforce: calls the Report API to get account IDs in the report.
   * For HubSpot: calls the List API to get company IDs in the list.
   *
   * Returns CRM-native IDs (Salesforce Account IDs or HubSpot Company IDs).
   */
  private async fetchCrmReportAccountIds(
    _organizationId: string,
    provider: CRMProvider,
    reportId: string
  ): Promise<string[]> {
    // This would call Merge.dev's passthrough API to hit the CRM directly:
    //
    // Salesforce:
    //   GET /api/v1/passthrough { method: "GET", path: "/analytics/reports/{reportId}" }
    //   Parse the report rows to extract Account IDs
    //
    // HubSpot:
    //   GET /api/v1/passthrough { method: "GET", path: "/contacts/v1/lists/{listId}/contacts/all" }
    //   Extract company IDs from the list members
    //
    // For now, this is a placeholder that would be implemented with the
    // actual Merge.dev API client.

    console.log(
      `[CRM Sync] Fetching ${provider} report ${reportId} — implement with Merge.dev passthrough`
    );

    return [];
  }

  /**
   * Matches CRM-native account IDs to our local Account records.
   */
  private async matchCrmIdsToAccounts(
    organizationId: string,
    provider: CRMProvider,
    crmAccountIds: string[]
  ): Promise<string[]> {
    if (crmAccountIds.length === 0) return [];

    const field =
      provider === "SALESFORCE" ? "salesforceId" : "hubspotId";

    const accounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        [field]: { in: crmAccountIds },
      },
      select: { id: true },
    });

    return accounts.map((a: { id: string }) => a.id);
  }
}
