/**
 * Integration Sync Engine
 *
 * Orchestrates periodic data sync from all enabled direct integrations.
 * Uses BullMQ repeatable jobs to poll providers on a configurable schedule.
 *
 * The sync engine:
 *   1. Discovers all enabled IntegrationConfigs across all orgs
 *   2. For each config, calls the appropriate provider to fetch new data
 *   3. Normalizes and persists the data through existing Prisma models
 *   4. Queues calls for the existing processing pipeline (chunk → tag → embed)
 *   5. Updates the sync cursor and status for incremental sync
 *
 * Call recording providers (Grain, Gong) feed into the Call → Transcript
 * pipeline. CRM providers (Salesforce) feed into Account → Contact →
 * Opportunity models for entity resolution.
 */

import type { PrismaClient, IntegrationConfig } from "@prisma/client";
import type { Queue } from "bullmq";
import type { ProcessCallJob } from "../services/transcript-processor.js";
import {
  EntityResolver,
  normalizeCompanyName,
  extractEmailDomain,
} from "../services/entity-resolution.js";
import type {
  CallRecordingProvider,
  CRMDataProvider,
  NormalizedCall,
  NormalizedAccount,
  NormalizedContact,
  NormalizedOpportunity,
  ProviderCredentials,
  ProviderRegistry,
} from "./types.js";

// ─── Sync Engine ────────────────────────────────────────────────────────────

export class SyncEngine {
  private prisma: PrismaClient;
  private processingQueue: Queue;
  private registry: ProviderRegistry;

  constructor(
    prisma: PrismaClient,
    processingQueue: Queue,
    registry: ProviderRegistry
  ) {
    this.prisma = prisma;
    this.processingQueue = processingQueue;
    this.registry = registry;
  }

  /**
   * Run a full sync cycle for all enabled integrations across all orgs.
   * Called by the BullMQ repeatable job scheduler.
   */
  async syncAll(): Promise<void> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: {
        enabled: true,
        status: { in: ["ACTIVE", "ERROR"] }, // retry errored ones too
      },
    });

    for (const config of configs) {
      try {
        await this.syncIntegration(config);
      } catch (err) {
        console.error(
          `Sync failed for ${config.provider} (org: ${config.organizationId}):`,
          err
        );
        await this.prisma.integrationConfig.update({
          where: { id: config.id },
          data: {
            status: "ERROR",
            lastError:
              err instanceof Error ? err.message : "Unknown sync error",
          },
        });
      }
    }
  }

  /**
   * Sync a single integration config. Used for on-demand sync triggers.
   */
  async syncIntegration(config: IntegrationConfig): Promise<void> {
    const credentials = config.credentials as unknown as ProviderCredentials;

    // Route to the appropriate sync handler
    const callProvider = this.registry.callRecording.get(config.provider);
    if (callProvider) {
      await this.syncCallRecordingProvider(
        config,
        callProvider,
        credentials
      );
      return;
    }

    const crmProvider = this.registry.crm.get(config.provider);
    if (crmProvider) {
      await this.syncCRMProvider(config, crmProvider, credentials);
      return;
    }

    console.warn(`No provider implementation registered for ${config.provider}`);
  }

  // ─── Call Recording Sync ──────────────────────────────────────────────────

  private async syncCallRecordingProvider(
    config: IntegrationConfig,
    provider: CallRecordingProvider,
    credentials: ProviderCredentials
  ): Promise<void> {
    let cursor = config.syncCursor;
    let hasMore = true;
    let totalSynced = 0;
    const resolver = new EntityResolver(this.prisma);

    while (hasMore) {
      const result = await provider.fetchCalls(
        credentials,
        cursor,
        config.lastSyncAt
      );

      for (const normalizedCall of result.data) {
        await this.persistCall(
          config,
          provider,
          resolver,
          normalizedCall
        );
        totalSynced++;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;

      // Update cursor after each page to allow resume on failure
      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: { syncCursor: cursor },
      });
    }

    // Mark sync complete
    await this.prisma.integrationConfig.update({
      where: { id: config.id },
      data: {
        lastSyncAt: new Date(),
        syncCursor: null, // reset cursor for next full sync
        status: "ACTIVE",
        lastError: null,
      },
    });

    if (totalSynced > 0) {
      console.log(
        `Synced ${totalSynced} calls from ${provider.name} for org ${config.organizationId}`
      );
    }
  }

  private async persistCall(
    config: IntegrationConfig,
    provider: CallRecordingProvider,
    resolver: EntityResolver,
    normalizedCall: NormalizedCall
  ): Promise<void> {
    const organizationId = config.organizationId;

    // Check if this call already exists (by provider + externalId)
    const existing = await this.prisma.call.findFirst({
      where: {
        organizationId,
        provider: provider.callProvider,
        externalId: normalizedCall.externalId,
      },
    });

    // Upsert the call
    const call = existing
      ? await this.prisma.call.update({
          where: { id: existing.id },
          data: {
            title: normalizedCall.title ?? undefined,
            recordingUrl: normalizedCall.recordingUrl ?? undefined,
            duration: normalizedCall.duration ?? undefined,
          },
        })
      : await this.prisma.call.create({
          data: {
            organizationId,
            title: normalizedCall.title,
            provider: provider.callProvider,
            externalId: normalizedCall.externalId,
            recordingUrl: normalizedCall.recordingUrl,
            duration: normalizedCall.duration,
            occurredAt: normalizedCall.occurredAt,
          },
        });

    // Store participants (only for new calls to avoid duplicates)
    if (!existing) {
      for (const p of normalizedCall.participants) {
        await this.prisma.callParticipant.create({
          data: {
            callId: call.id,
            email: p.email,
            name: p.name,
            isHost: p.isHost,
          },
        });
      }
    }

    // Entity resolution
    const participantInputs = normalizedCall.participants.map((p) => ({
      email: p.email ?? undefined,
      name: p.name ?? undefined,
    }));

    const resolution = await resolver.resolveAndLinkContacts(
      organizationId,
      call.id,
      participantInputs
    );

    // Store transcript
    let hasTranscript = false;
    if (normalizedCall.transcript && !existing) {
      await this.prisma.transcript.create({
        data: {
          callId: call.id,
          fullText: normalizedCall.transcript,
          wordCount: normalizedCall.transcript.split(/\s+/).length,
        },
      });
      hasTranscript = true;
    }

    // Queue for processing pipeline (chunking → tagging → embedding)
    if (hasTranscript) {
      const job: ProcessCallJob = {
        callId: call.id,
        organizationId,
        accountId: resolution.accountId || null,
        hasTranscript: true,
      };

      await this.processingQueue.add("process-call", job, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      });
    }
  }

  // ─── CRM Sync ────────────────────────────────────────────────────────────

  private async syncCRMProvider(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<void> {
    // Sync accounts first (contacts reference them)
    await this.syncAccounts(config, provider, credentials);
    await this.syncContacts(config, provider, credentials);
    await this.syncOpportunities(config, provider, credentials);

    // Mark sync complete
    await this.prisma.integrationConfig.update({
      where: { id: config.id },
      data: {
        lastSyncAt: new Date(),
        syncCursor: null,
        status: "ACTIVE",
        lastError: null,
      },
    });
  }

  private async syncAccounts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<void> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const result = await provider.fetchAccounts(
        credentials,
        cursor,
        config.lastSyncAt
      );

      for (const account of result.data) {
        await this.persistAccount(config.organizationId, account);
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
  }

  private async persistAccount(
    organizationId: string,
    account: NormalizedAccount
  ): Promise<void> {
    const normalized = normalizeCompanyName(account.name);

    // Upsert by salesforceId
    await this.prisma.account.upsert({
      where: {
        organizationId_salesforceId: {
          organizationId,
          salesforceId: account.externalId,
        },
      },
      create: {
        organizationId,
        name: account.name,
        normalizedName: normalized,
        domain: account.domain,
        salesforceId: account.externalId,
        industry: account.industry,
        employeeCount: account.employeeCount,
        annualRevenue: account.annualRevenue,
      },
      update: {
        name: account.name,
        normalizedName: normalized,
        domain: account.domain ?? undefined,
        industry: account.industry ?? undefined,
        employeeCount: account.employeeCount ?? undefined,
        annualRevenue: account.annualRevenue ?? undefined,
      },
    });
  }

  private async syncContacts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<void> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const result = await provider.fetchContacts(
        credentials,
        cursor,
        config.lastSyncAt
      );

      for (const contact of result.data) {
        await this.persistContact(config.organizationId, contact);
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
  }

  private async persistContact(
    organizationId: string,
    contact: NormalizedContact
  ): Promise<void> {
    if (!contact.email) return;

    const domain = extractEmailDomain(contact.email);
    if (!domain) return;

    // Find the account this contact belongs to
    let account = null;
    if (contact.accountExternalId) {
      account = await this.prisma.account.findFirst({
        where: { organizationId, salesforceId: contact.accountExternalId },
      });
    }

    // Fall back to domain matching
    if (!account) {
      account = await this.prisma.account.findFirst({
        where: { organizationId, domain },
      });
    }

    if (!account) return; // Can't place this contact without an account

    await this.prisma.contact.upsert({
      where: {
        accountId_email: {
          accountId: account.id,
          email: contact.email.toLowerCase(),
        },
      },
      create: {
        accountId: account.id,
        email: contact.email.toLowerCase(),
        emailDomain: domain,
        name: contact.name,
        title: contact.title,
        phone: contact.phone,
        salesforceId: contact.externalId,
      },
      update: {
        name: contact.name ?? undefined,
        title: contact.title ?? undefined,
        phone: contact.phone ?? undefined,
        salesforceId: contact.externalId,
      },
    });
  }

  private async syncOpportunities(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<void> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const result = await provider.fetchOpportunities(
        credentials,
        cursor,
        config.lastSyncAt
      );

      for (const opp of result.data) {
        await this.persistOpportunity(config.organizationId, opp);
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
  }

  private async persistOpportunity(
    organizationId: string,
    opp: NormalizedOpportunity
  ): Promise<void> {
    if (!opp.accountExternalId) return;

    const account = await this.prisma.account.findFirst({
      where: { organizationId, salesforceId: opp.accountExternalId },
    });

    if (!account) return;

    // Map normalized status to SalesforceEventType
    let eventType:
      | "CLOSED_WON"
      | "CLOSED_LOST"
      | "OPPORTUNITY_STAGE_CHANGE"
      | "OPPORTUNITY_CREATED";

    if (opp.status === "WON") {
      eventType = "CLOSED_WON";
    } else if (opp.status === "LOST") {
      eventType = "CLOSED_LOST";
    } else {
      eventType = "OPPORTUNITY_STAGE_CHANGE";
    }

    // Avoid duplicate events by checking for existing opportunity + stage
    const existing = await this.prisma.salesforceEvent.findFirst({
      where: {
        accountId: account.id,
        opportunityId: opp.externalId,
        stageName: opp.stage,
      },
    });

    if (existing) return; // Already recorded this stage

    await this.prisma.salesforceEvent.create({
      data: {
        accountId: account.id,
        eventType,
        stageName: opp.stage,
        opportunityId: opp.externalId,
        amount: opp.amount,
        closeDate: opp.closeDate,
        description: opp.name,
      },
    });
  }
}
