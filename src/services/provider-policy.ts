import type { IntegrationProvider } from "@prisma/client";
import type {
  CallRecordingProvider,
  CRMDataProvider,
  ProviderRegistry,
} from "../integrations/types.js";
import type { AIProviderName } from "./ai-client.js";

export const DIRECT_INTEGRATION_PROVIDERS = [
  "GRAIN",
  "GONG",
  "SALESFORCE",
  "MERGE_DEV",
] as const;

export const CRM_REPORT_PROVIDERS = ["SALESFORCE", "HUBSPOT"] as const;

export const AI_PROVIDER_NAMES = ["openai", "anthropic", "google"] as const;

export type DirectIntegrationProvider =
  (typeof DIRECT_INTEGRATION_PROVIDERS)[number];
export type CRMReportProvider = (typeof CRM_REPORT_PROVIDERS)[number];

export interface IntegrationProviderSelection {
  provider: DirectIntegrationProvider;
  kind: "webhook_only" | "call_recording" | "crm" | "unregistered";
  callProvider: CallRecordingProvider | null;
  crmProvider: CRMDataProvider | null;
  supportsCredentialValidation: boolean;
  supportsManualSync: boolean;
}

function normalizeUpper(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeLower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function parseDirectIntegrationProvider(
  value: unknown
): DirectIntegrationProvider | null {
  const normalized = normalizeUpper(value);
  return DIRECT_INTEGRATION_PROVIDERS.find((p) => p === normalized) ?? null;
}

export function parseCRMReportProvider(
  value: unknown
): CRMReportProvider | null {
  const normalized = normalizeUpper(value);
  return CRM_REPORT_PROVIDERS.find((p) => p === normalized) ?? null;
}

export function parseAIProviderName(value: unknown): AIProviderName | null {
  const normalized = normalizeLower(value);
  return (
    AI_PROVIDER_NAMES.find((provider) => provider === normalized) ?? null
  );
}

export function resolveIntegrationProviderSelection(
  provider: DirectIntegrationProvider,
  registry: ProviderRegistry
): IntegrationProviderSelection {
  const normalizedProvider = provider as IntegrationProvider;
  const callProvider = registry.callRecording.get(normalizedProvider) ?? null;
  const crmProvider = registry.crm.get(normalizedProvider) ?? null;

  if (provider === "MERGE_DEV") {
    return {
      provider,
      kind: "webhook_only",
      callProvider: null,
      crmProvider: null,
      supportsCredentialValidation: false,
      supportsManualSync: false,
    };
  }

  if (callProvider) {
    return {
      provider,
      kind: "call_recording",
      callProvider,
      crmProvider: null,
      supportsCredentialValidation: true,
      supportsManualSync: true,
    };
  }

  if (crmProvider) {
    return {
      provider,
      kind: "crm",
      callProvider: null,
      crmProvider,
      supportsCredentialValidation: true,
      supportsManualSync: true,
    };
  }

  return {
    provider,
    kind: "unregistered",
    callProvider: null,
    crmProvider: null,
    supportsCredentialValidation: false,
    supportsManualSync: false,
  };
}
