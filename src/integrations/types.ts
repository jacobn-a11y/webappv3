/**
 * Integration Provider Abstraction Layer
 *
 * Defines the common interfaces that all call-recording and CRM providers
 * must implement. This lets the sync engine treat Grain, Gong, Salesforce,
 * and future providers uniformly while each provider handles its own API
 * specifics internally.
 *
 * The abstraction has two sides:
 *   - CallRecordingProvider: ingests calls + transcripts (Grain, Gong)
 *   - CRMProvider: ingests accounts, contacts, opportunities (Salesforce)
 *
 * Merge.dev remains available as a "universal" provider behind a feature
 * flag — it implements both interfaces via its unified API.
 */

import type { CallProvider, IntegrationProvider } from "@prisma/client";

// ─── Credentials Shapes ──────────────────────────────────────────────────────
// Each provider stores credentials as JSON in IntegrationConfig.credentials.
// These types define the expected shape for validation.

export interface GongCredentials {
  accessKey: string;
  accessKeySecret: string;
  /** Gong base URL — defaults to https://api.gong.io */
  baseUrl?: string;
}

export interface GrainCredentials {
  apiToken: string;
  /** Grain API base URL — defaults to https://api.grain.com */
  baseUrl?: string;
}

export interface SalesforceCredentials {
  instanceUrl: string; // e.g., "https://yourorg.my.salesforce.com"
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface MergeDevCredentials {
  apiKey: string;
  accountToken: string;
  webhookSecret: string;
}

export type ProviderCredentials =
  | GongCredentials
  | GrainCredentials
  | SalesforceCredentials
  | MergeDevCredentials;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function toProviderCredentials(
  value: Record<string, unknown>
): ProviderCredentials {
  if (isNonEmptyString(value.accessKey) && isNonEmptyString(value.accessKeySecret)) {
    return {
      accessKey: value.accessKey,
      accessKeySecret: value.accessKeySecret,
      ...(isNonEmptyString(value.baseUrl) ? { baseUrl: value.baseUrl } : {}),
    };
  }

  if (isNonEmptyString(value.apiToken)) {
    return {
      apiToken: value.apiToken,
      ...(isNonEmptyString(value.baseUrl) ? { baseUrl: value.baseUrl } : {}),
    };
  }

  if (
    isNonEmptyString(value.instanceUrl) &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.refreshToken) &&
    isNonEmptyString(value.clientId) &&
    isNonEmptyString(value.clientSecret)
  ) {
    return {
      instanceUrl: value.instanceUrl,
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      clientId: value.clientId,
      clientSecret: value.clientSecret,
    };
  }

  if (
    isNonEmptyString(value.apiKey) &&
    isNonEmptyString(value.accountToken) &&
    isNonEmptyString(value.webhookSecret)
  ) {
    return {
      apiKey: value.apiKey,
      accountToken: value.accountToken,
      webhookSecret: value.webhookSecret,
    };
  }

  throw new Error("Invalid provider credentials shape");
}

export function coerceProviderCredentials(
  value: Record<string, unknown>
): ProviderCredentials {
  return JSON.parse(JSON.stringify(value));
}

// ─── Normalized Data Types ──────────────────────────────────────────────────
// These are the canonical shapes that providers normalize their API responses
// into. The sync engine then persists them through the existing Prisma models.

export interface NormalizedCall {
  /** Provider's native ID for this call */
  externalId: string;
  title: string | null;
  recordingUrl: string | null;
  /** Duration in seconds */
  duration: number | null;
  occurredAt: Date;
  participants: NormalizedParticipant[];
  /** Full transcript text, if available inline */
  transcript: string | null;
  /** Provider-derived account candidates (highest-confidence first). */
  accountHints?: string[];
  primaryAccountHint?: string | null;
  /** Optional provider summaries surfaced during initial ingest. */
  summary?: string | null;
  outline?: string[];
}

export interface NormalizedParticipant {
  email: string | null;
  name: string | null;
  isHost: boolean;
  speakerId?: string | null;
  title?: string | null;
  affiliation?: string | null;
}

export interface NormalizedAccount {
  externalId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
}

export interface NormalizedContact {
  externalId: string;
  email: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  /** The external ID of the account this contact belongs to */
  accountExternalId: string | null;
}

export interface NormalizedOpportunity {
  externalId: string;
  name: string | null;
  amount: number | null;
  stage: string | null;
  status: "OPEN" | "WON" | "LOST";
  closeDate: Date | null;
  /** The external ID of the account this opportunity belongs to */
  accountExternalId: string | null;
}

// ─── Provider Interfaces ────────────────────────────────────────────────────

export interface SyncResult<T> {
  data: T[];
  /** Opaque cursor for the next incremental sync. Null if no more pages. */
  nextCursor: string | null;
  /** Whether there are more pages to fetch in this sync run */
  hasMore: boolean;
}

/**
 * Interface for call recording providers (Grain, Gong, etc.)
 *
 * Providers fetch calls and transcripts from their respective APIs and
 * normalize them into a common shape for the sync engine to persist.
 */
export interface CallRecordingProvider {
  readonly name: IntegrationProvider;
  readonly callProvider: CallProvider;

  /**
   * Validate that the stored credentials are still functional.
   * Used during setup and health checks.
   */
  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;

  /**
   * Fetch calls incrementally since the given cursor/timestamp.
   * Returns normalized call data and a cursor for the next sync.
   */
  fetchCalls(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null,
    options?: { settings?: Record<string, unknown> | null }
  ): Promise<SyncResult<NormalizedCall>>;

  /**
   * Fetch the full transcript for a specific call by its external ID.
   * Some providers include transcripts inline with fetchCalls(); this
   * method is for providers that require a separate API call.
   */
  fetchTranscript(
    credentials: ProviderCredentials,
    externalCallId: string
  ): Promise<string | null>;
}

/**
 * Interface for CRM providers (Salesforce, etc.)
 *
 * Read-only: fetches accounts, contacts, and opportunities for entity
 * resolution and opportunity tracking. Never writes back to the CRM.
 */
export interface CRMDataProvider {
  readonly name: IntegrationProvider;

  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;

  fetchAccounts(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedAccount>>;

  fetchContacts(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedContact>>;

  fetchOpportunities(
    credentials: ProviderCredentials,
    cursor: string | null,
    since: Date | null
  ): Promise<SyncResult<NormalizedOpportunity>>;
}

// ─── Provider Registry Types ────────────────────────────────────────────────

/**
 * Maps IntegrationProvider enum values to their provider implementations.
 * The sync engine uses this to dispatch to the right provider.
 */
export interface ProviderRegistry {
  callRecording: Map<IntegrationProvider, CallRecordingProvider>;
  crm: Map<IntegrationProvider, CRMDataProvider>;
}
