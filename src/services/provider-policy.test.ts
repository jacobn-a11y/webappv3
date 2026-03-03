import { describe, it, expect, vi } from "vitest";
import type {
  CallRecordingProvider,
  CRMDataProvider,
  ProviderRegistry,
  ProviderCredentials,
  SyncResult,
  NormalizedCall,
  NormalizedAccount,
  NormalizedContact,
  NormalizedOpportunity,
} from "../integrations/types.js";
import {
  parseAIProviderName,
  parseCRMReportProvider,
  parseDirectIntegrationProvider,
  resolveIntegrationProviderSelection,
} from "./provider-policy.js";

function createCallProvider(name: "GONG" | "GRAIN"): CallRecordingProvider {
  return {
    name,
    callProvider: name,
    validateCredentials: vi.fn(async (_credentials: ProviderCredentials) => true),
    fetchCalls: vi.fn(
      async (
        _credentials: ProviderCredentials,
        _cursor: string | null,
        _since: Date | null
      ): Promise<SyncResult<NormalizedCall>> => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })
    ),
    fetchTranscript: vi.fn(async (_credentials: ProviderCredentials, _externalId: string) => ""),
  };
}

function createCRMProvider(name: "SALESFORCE"): CRMDataProvider {
  return {
    name,
    validateCredentials: vi.fn(async (_credentials: ProviderCredentials) => true),
    fetchAccounts: vi.fn(
      async (
        _credentials: ProviderCredentials,
        _cursor: string | null,
        _since: Date | null
      ): Promise<SyncResult<NormalizedAccount>> => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })
    ),
    fetchContacts: vi.fn(
      async (
        _credentials: ProviderCredentials,
        _cursor: string | null,
        _since: Date | null
      ): Promise<SyncResult<NormalizedContact>> => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })
    ),
    fetchOpportunities: vi.fn(
      async (
        _credentials: ProviderCredentials,
        _cursor: string | null,
        _since: Date | null
      ): Promise<SyncResult<NormalizedOpportunity>> => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })
    ),
  };
}

describe("provider-policy parsers", () => {
  it("parses direct integration providers case-insensitively", () => {
    expect(parseDirectIntegrationProvider(" gong ")).toBe("GONG");
    expect(parseDirectIntegrationProvider("merge_dev")).toBe("MERGE_DEV");
  });

  it("rejects invalid direct integration providers", () => {
    expect(parseDirectIntegrationProvider("hubspot")).toBeNull();
    expect(parseDirectIntegrationProvider(null)).toBeNull();
  });

  it("parses CRM report providers case-insensitively", () => {
    expect(parseCRMReportProvider("salesforce")).toBe("SALESFORCE");
    expect(parseCRMReportProvider(" HUBSPOT ")).toBe("HUBSPOT");
  });

  it("rejects invalid CRM report providers", () => {
    expect(parseCRMReportProvider("GONG")).toBeNull();
  });

  it("parses AI provider names case-insensitively", () => {
    expect(parseAIProviderName("OpenAI")).toBe("openai");
    expect(parseAIProviderName(" Anthropic ")).toBe("anthropic");
    expect(parseAIProviderName("GOOGLE")).toBe("google");
  });

  it("rejects invalid AI provider names", () => {
    expect(parseAIProviderName("azure-openai")).toBeNull();
  });
});

describe("resolveIntegrationProviderSelection", () => {
  const gongProvider = createCallProvider("GONG");
  const salesforceProvider = createCRMProvider("SALESFORCE");
  const registry: ProviderRegistry = {
    callRecording: new Map([["GONG", gongProvider]]),
    crm: new Map([["SALESFORCE", salesforceProvider]]),
  };

  it("returns webhook_only for MERGE_DEV", () => {
    const selection = resolveIntegrationProviderSelection("MERGE_DEV", registry);
    expect(selection.kind).toBe("webhook_only");
    expect(selection.supportsCredentialValidation).toBe(false);
    expect(selection.supportsManualSync).toBe(false);
  });

  it("returns call_recording for registered call providers", () => {
    const selection = resolveIntegrationProviderSelection("GONG", registry);
    expect(selection.kind).toBe("call_recording");
    expect(selection.callProvider).toBe(gongProvider);
    expect(selection.crmProvider).toBeNull();
    expect(selection.supportsCredentialValidation).toBe(true);
    expect(selection.supportsManualSync).toBe(true);
  });

  it("returns crm for registered CRM providers", () => {
    const selection = resolveIntegrationProviderSelection("SALESFORCE", registry);
    expect(selection.kind).toBe("crm");
    expect(selection.crmProvider).toBe(salesforceProvider);
    expect(selection.callProvider).toBeNull();
    expect(selection.supportsCredentialValidation).toBe(true);
    expect(selection.supportsManualSync).toBe(true);
  });

  it("returns unregistered when provider has no implementation", () => {
    const selection = resolveIntegrationProviderSelection("GRAIN", registry);
    expect(selection.kind).toBe("unregistered");
    expect(selection.callProvider).toBeNull();
    expect(selection.crmProvider).toBeNull();
    expect(selection.supportsCredentialValidation).toBe(false);
    expect(selection.supportsManualSync).toBe(false);
  });
});
