/**
 * Salesforce Direct Integration Provider (Read-Only)
 *
 * Connects to the Salesforce REST API to read accounts, contacts, and
 * opportunities. This is a read-only integration — StoryEngine never
 * writes back to Salesforce.
 *
 * Auth: OAuth2 (Connected App with refresh token flow)
 * Base URL: https://{instance}.my.salesforce.com/services/data/v59.0
 *
 * Uses SOQL queries for efficient incremental sync with SystemModstamp
 * filtering and LIMIT/OFFSET pagination.
 *
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/
 */

import type { IntegrationProvider } from "@prisma/client";
import type {
  CRMDataProvider,
  NormalizedAccount,
  NormalizedContact,
  NormalizedOpportunity,
  ProviderCredentials,
  SalesforceCredentials,
  SyncResult,
} from "./types.js";

// ─── Salesforce API Response Types ──────────────────────────────────────────

interface SoqlResponse<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

interface SFAccount {
  Id: string;
  Name: string;
  Website?: string;
  Industry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
}

interface SFContact {
  Id: string;
  Email?: string;
  Name?: string;
  Title?: string;
  Phone?: string;
  AccountId?: string;
}

interface SFOpportunity {
  Id: string;
  Name?: string;
  Amount?: number;
  StageName?: string;
  IsClosed?: boolean;
  IsWon?: boolean;
  CloseDate?: string;
  AccountId?: string;
}

// ─── Provider Implementation ────────────────────────────────────────────────

const API_VERSION = "v59.0";
const PAGE_SIZE = 200;

function asSalesforceCredentials(
  creds: ProviderCredentials
): SalesforceCredentials {
  const c = creds as SalesforceCredentials;
  if (!c.instanceUrl || !c.accessToken) {
    throw new Error(
      "Invalid Salesforce credentials: missing instanceUrl or accessToken"
    );
  }
  return c;
}

/**
 * Extracts domain from a URL. "https://acme.com/about" → "acme.com"
 */
function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(
      url.startsWith("http") ? url : `https://${url}`
    );
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export class SalesforceProvider implements CRMDataProvider {
  readonly name: IntegrationProvider = "SALESFORCE";

  private baseUrl(creds: SalesforceCredentials): string {
    return `${creds.instanceUrl.replace(/\/$/, "")}/services/data/${API_VERSION}`;
  }

  private headers(creds: SalesforceCredentials): Record<string, string> {
    return {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  async validateCredentials(
    credentials: ProviderCredentials
  ): Promise<boolean> {
    const creds = asSalesforceCredentials(credentials);
    try {
      const res = await fetch(`${this.baseUrl(creds)}/limits`, {
        method: "GET",
        headers: this.headers(creds),
      });
      if (res.status === 401) {
        // Try refreshing the token
        const refreshed = await this.refreshAccessToken(creds);
        if (!refreshed) return false;
        const retryRes = await fetch(`${this.baseUrl(creds)}/limits`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${refreshed}`,
            "Content-Type": "application/json",
          },
        });
        return retryRes.status === 200;
      }
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchAccounts(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedAccount>> {
    const creds = asSalesforceCredentials(credentials);

    if (cursor) {
      // cursor is a nextRecordsUrl — fetch it directly
      return this.fetchNextPage<SFAccount, NormalizedAccount>(
        creds,
        cursor,
        this.normalizeAccount
      );
    }

    const whereClause = since
      ? `WHERE SystemModstamp > ${since.toISOString()}`
      : "";

    const soql = `SELECT Id, Name, Website, Industry, NumberOfEmployees, AnnualRevenue FROM Account ${whereClause} ORDER BY SystemModstamp ASC LIMIT ${PAGE_SIZE}`;

    return this.executeSoql<SFAccount, NormalizedAccount>(
      creds,
      soql,
      this.normalizeAccount
    );
  }

  async fetchContacts(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedContact>> {
    const creds = asSalesforceCredentials(credentials);

    if (cursor) {
      return this.fetchNextPage<SFContact, NormalizedContact>(
        creds,
        cursor,
        this.normalizeContact
      );
    }

    const whereClause = since
      ? `WHERE SystemModstamp > ${since.toISOString()}`
      : "";

    const soql = `SELECT Id, Email, Name, Title, Phone, AccountId FROM Contact ${whereClause} ORDER BY SystemModstamp ASC LIMIT ${PAGE_SIZE}`;

    return this.executeSoql<SFContact, NormalizedContact>(
      creds,
      soql,
      this.normalizeContact
    );
  }

  async fetchOpportunities(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedOpportunity>> {
    const creds = asSalesforceCredentials(credentials);

    if (cursor) {
      return this.fetchNextPage<SFOpportunity, NormalizedOpportunity>(
        creds,
        cursor,
        this.normalizeOpportunity
      );
    }

    const whereClause = since
      ? `WHERE SystemModstamp > ${since.toISOString()}`
      : "";

    const soql = `SELECT Id, Name, Amount, StageName, IsClosed, IsWon, CloseDate, AccountId FROM Opportunity ${whereClause} ORDER BY SystemModstamp ASC LIMIT ${PAGE_SIZE}`;

    return this.executeSoql<SFOpportunity, NormalizedOpportunity>(
      creds,
      soql,
      this.normalizeOpportunity
    );
  }

  // ─── Private: SOQL Execution ─────────────────────────────────────────────

  private async executeSoql<TRaw, TNorm>(
    creds: SalesforceCredentials,
    soql: string,
    normalize: (record: TRaw) => TNorm
  ): Promise<SyncResult<TNorm>> {
    const base = this.baseUrl(creds);
    const url = `${base}/query?q=${encodeURIComponent(soql)}`;

    let res = await fetch(url, {
      method: "GET",
      headers: this.headers(creds),
    });

    // Handle token expiry with one refresh attempt
    if (res.status === 401) {
      const newToken = await this.refreshAccessToken(creds);
      if (!newToken) {
        throw new Error("Salesforce token refresh failed");
      }
      creds.accessToken = newToken;
      res = await fetch(url, {
        method: "GET",
        headers: this.headers(creds),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Salesforce SOQL error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as SoqlResponse<TRaw>;

    return {
      data: data.records.map(normalize),
      nextCursor: data.nextRecordsUrl ?? null,
      hasMore: !data.done,
    };
  }

  private async fetchNextPage<TRaw, TNorm>(
    creds: SalesforceCredentials,
    nextRecordsUrl: string,
    normalize: (record: TRaw) => TNorm
  ): Promise<SyncResult<TNorm>> {
    const instanceBase = creds.instanceUrl.replace(/\/$/, "");
    const url = `${instanceBase}${nextRecordsUrl}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.headers(creds),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Salesforce pagination error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as SoqlResponse<TRaw>;

    return {
      data: data.records.map(normalize),
      nextCursor: data.nextRecordsUrl ?? null,
      hasMore: !data.done,
    };
  }

  // ─── Private: Token Refresh ──────────────────────────────────────────────

  private async refreshAccessToken(
    creds: SalesforceCredentials
  ): Promise<string | null> {
    if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
      return null;
    }

    try {
      const tokenUrl = `${creds.instanceUrl.replace(/\/$/, "")}/services/oauth2/token`;
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });

      const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    } catch {
      return null;
    }
  }

  // ─── Private: Normalization ──────────────────────────────────────────────

  private normalizeAccount(record: SFAccount): NormalizedAccount {
    return {
      externalId: record.Id,
      name: record.Name,
      domain: record.Website
        ? extractDomainFromUrl(record.Website)
        : null,
      industry: record.Industry ?? null,
      employeeCount: record.NumberOfEmployees ?? null,
      annualRevenue: record.AnnualRevenue ?? null,
    };
  }

  private normalizeContact(record: SFContact): NormalizedContact {
    return {
      externalId: record.Id,
      email: record.Email ?? "",
      name: record.Name ?? null,
      title: record.Title ?? null,
      phone: record.Phone ?? null,
      accountExternalId: record.AccountId ?? null,
    };
  }

  private normalizeOpportunity(record: SFOpportunity): NormalizedOpportunity {
    let status: "OPEN" | "WON" | "LOST" = "OPEN";
    if (record.IsClosed) {
      status = record.IsWon ? "WON" : "LOST";
    }

    return {
      externalId: record.Id,
      name: record.Name ?? null,
      amount: record.Amount ?? null,
      stage: record.StageName ?? null,
      status,
      closeDate: record.CloseDate ? new Date(record.CloseDate) : null,
      accountExternalId: record.AccountId ?? null,
    };
  }
}
