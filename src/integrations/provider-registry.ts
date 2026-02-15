/**
 * Provider Registry
 *
 * Centralizes the mapping from IntegrationProvider enum values to their
 * concrete implementations. New providers are added here — one line each.
 *
 * The registry is created once at startup and passed to the SyncEngine
 * and webhook handlers.
 */

import type { IntegrationProvider } from "@prisma/client";
import type {
  CallRecordingProvider,
  CRMDataProvider,
  ProviderRegistry,
} from "./types.js";
import { GongProvider } from "./gong-provider.js";
import { GrainProvider } from "./grain-provider.js";
import { SalesforceProvider } from "./salesforce-provider.js";

/**
 * Build the default provider registry with all available direct integrations.
 *
 * To add a new provider:
 *   1. Implement CallRecordingProvider or CRMDataProvider
 *   2. Register it here
 *   3. Add the enum value to IntegrationProvider in the Prisma schema
 */
export function createProviderRegistry(): ProviderRegistry {
  const callRecording = new Map<IntegrationProvider, CallRecordingProvider>();
  const crm = new Map<IntegrationProvider, CRMDataProvider>();

  // ── Call Recording Providers ──────────────────────────────────────────
  const gong = new GongProvider();
  callRecording.set(gong.name, gong);

  const grain = new GrainProvider();
  callRecording.set(grain.name, grain);

  // ── CRM Providers ────────────────────────────────────────────────────
  const salesforce = new SalesforceProvider();
  crm.set(salesforce.name, salesforce);

  // Note: MERGE_DEV is handled separately via its webhook-based flow.
  // It is not registered here because it uses push-based webhooks
  // rather than pull-based sync. When enabled, the existing
  // merge-webhook.ts handler processes its events.

  return { callRecording, crm };
}
