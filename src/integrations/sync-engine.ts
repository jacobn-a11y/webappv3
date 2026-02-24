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

import { Prisma, type PrismaClient, type IntegrationConfig } from "@prisma/client";
import type { Queue } from "bullmq";
import type { ProcessCallJob } from "../services/transcript-processor.js";
import { enqueueProcessCallJob } from "../lib/queue-policy.js";
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

  private async withRetry<T>(
    fn: () => Promise<T>,
    opts?: { attempts?: number; baseDelayMs?: number }
  ): Promise<T> {
    const attempts = opts?.attempts ?? 3;
    const baseDelayMs = opts?.baseDelayMs ?? 750;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i === attempts - 1) break;
        const exp = baseDelayMs * 2 ** i;
        const jitter = Math.floor(Math.random() * Math.max(100, exp * 0.25));
        const waitMs = exp + jitter;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Retry attempts exhausted");
  }

  private async queueMergeConflictReview(input: {
    organizationId: string;
    targetType: string;
    targetId: string;
    requestPayload: Record<string, unknown>;
  }): Promise<void> {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: {
        organizationId: input.organizationId,
        requestType: "DATA_MERGE_CONFLICT",
        targetType: input.targetType,
        targetId: input.targetId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (existing) return;

    const owner = await this.prisma.user.findFirst({
      where: {
        organizationId: input.organizationId,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return;

    await this.prisma.approvalRequest.create({
      data: {
        organizationId: input.organizationId,
        requestType: "DATA_MERGE_CONFLICT",
        targetType: input.targetType,
        targetId: input.targetId,
        requestedByUserId: owner.id,
        status: "PENDING",
        requestPayload: input.requestPayload as Prisma.InputJsonValue,
      },
    });
  }

  private async startIntegrationRun(input: {
    config: IntegrationConfig;
    runType: string;
    idempotencyKey: string;
  }) {
    const existing = await this.prisma.integrationRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.config.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.status === "COMPLETED" || existing.status === "RUNNING") {
        return { run: existing, skipped: true };
      }
      const restarted = await this.prisma.integrationRun.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          finishedAt: null,
          errorMessage: null,
          processedCount: 0,
          successCount: 0,
          failureCount: 0,
        },
      });
      return { run: restarted, skipped: false };
    }

    const run = await this.prisma.integrationRun.create({
      data: {
        organizationId: input.config.organizationId,
        integrationConfigId: input.config.id,
        provider: input.config.provider,
        runType: input.runType,
        status: "RUNNING",
        idempotencyKey: input.idempotencyKey,
        metadata: { trigger: input.runType },
      },
    });
    return { run, skipped: false };
  }

  private async finishIntegrationRun(input: {
    runId: string;
    status: "COMPLETED" | "FAILED";
    processedCount: number;
    successCount: number;
    failureCount: number;
    errorMessage?: string | null;
  }) {
    await this.prisma.integrationRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        processedCount: input.processedCount,
        successCount: input.successCount,
        failureCount: input.failureCount,
        errorMessage: input.errorMessage ?? null,
      },
    });
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
        const hourBucket = new Date().toISOString().slice(0, 13);
        await this.syncIntegration(config, {
          runType: "SCHEDULED",
          idempotencyKey: `scheduled:${config.id}:${hourBucket}`,
        });
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
  async syncIntegration(
    config: IntegrationConfig,
    options?: {
      runType?: "SCHEDULED" | "MANUAL" | "BACKFILL";
      idempotencyKey?: string;
      sinceOverride?: Date | null;
      cursorOverride?: string | null;
    }
  ): Promise<string> {
    const runType = options?.runType ?? "MANUAL";
    const idempotencyKey =
      options?.idempotencyKey ??
      `${runType.toLowerCase()}:${config.id}:${Date.now()}`;
    const started = await this.startIntegrationRun({
      config,
      runType,
      idempotencyKey,
    });
    if (started.skipped) return started.run.id;

    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    const credentials = config.credentials as unknown as ProviderCredentials;

    try {
      // Route to the appropriate sync handler
      const callProvider = this.registry.callRecording.get(config.provider);
      if (callProvider) {
        const synced = await this.syncCallRecordingProvider(
          config,
          callProvider,
          credentials,
          {
            sinceOverride: options?.sinceOverride ?? null,
            cursorOverride: options?.cursorOverride ?? null,
          }
        );
        processedCount += synced;
        successCount += synced;
      } else {
        const crmProvider = this.registry.crm.get(config.provider);
        if (crmProvider) {
          const synced = await this.syncCRMProvider(config, crmProvider, credentials);
          processedCount += synced;
          successCount += synced;
        } else {
          throw new Error(`No provider implementation registered for ${config.provider}`);
        }
      }

      await this.finishIntegrationRun({
        runId: started.run.id,
        status: "COMPLETED",
        processedCount,
        successCount,
        failureCount,
      });
      return started.run.id;
    } catch (err) {
      failureCount = Math.max(1, processedCount - successCount);
      await this.finishIntegrationRun({
        runId: started.run.id,
        status: "FAILED",
        processedCount,
        successCount,
        failureCount,
        errorMessage: err instanceof Error ? err.message : "Unknown sync error",
      });
      throw err;
    }
  }

  async replayFailedRun(runId: string, organizationId: string): Promise<void> {
    const run = await this.prisma.integrationRun.findFirst({
      where: {
        id: runId,
        organizationId,
      },
      include: { integrationConfig: true },
    });
    if (!run || !run.integrationConfig) {
      throw new Error("Integration run not found for this organization.");
    }

    await this.syncIntegration(run.integrationConfig, {
      runType: "BACKFILL",
      idempotencyKey: `replay:${run.id}:${Date.now()}`,
    });
  }

  // ─── Call Recording Sync ──────────────────────────────────────────────────

  private async syncCallRecordingProvider(
    config: IntegrationConfig,
    provider: CallRecordingProvider,
    credentials: ProviderCredentials,
    options?: { sinceOverride?: Date | null; cursorOverride?: string | null }
  ): Promise<number> {
    let cursor = options?.cursorOverride ?? config.syncCursor;
    let hasMore = true;
    let totalSynced = 0;
    const resolver = new EntityResolver(this.prisma);

    while (hasMore) {
      const result = await this.withRetry(
        () =>
          provider.fetchCalls(
            credentials,
            cursor,
            options?.sinceOverride ?? config.lastSyncAt,
            {
              settings:
                config.settings &&
                typeof config.settings === "object" &&
                !Array.isArray(config.settings)
                  ? (config.settings as Record<string, unknown>)
                  : null,
            }
          ),
        { attempts: 4, baseDelayMs: 1000 }
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
    return totalSynced;
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
      participantInputs,
      normalizedCall.title ?? undefined
    );

    if (
      !resolution.accountId &&
      normalizedCall.accountHints &&
      normalizedCall.accountHints.length > 0
    ) {
      await this.linkCallByProviderAccountHints({
        organizationId,
        callId: call.id,
        participants: normalizedCall.participants,
        accountHints: normalizedCall.accountHints,
      });
    }

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
        accountId:
          (await this.prisma.call.findUnique({
            where: { id: call.id },
            select: { accountId: true },
          }))?.accountId ?? null,
        hasTranscript: true,
      };

      await enqueueProcessCallJob({
        queue: this.processingQueue,
        payload: job,
        source: "integration-sync",
      });
    }
  }

  private async linkCallByProviderAccountHints(input: {
    organizationId: string;
    callId: string;
    participants: NormalizedCall["participants"];
    accountHints: string[];
  }): Promise<void> {
    const normalizedHints = input.accountHints
      .map((hint) => {
        const name = String(hint ?? "").trim();
        return {
          name,
          normalized: normalizeCompanyName(name),
        };
      })
      .filter((hint) => hint.name.length > 1 && hint.normalized.length > 1);

    if (normalizedHints.length === 0) return;

    const participantDomains = input.participants
      .map((p) => (p.email ? extractEmailDomain(p.email) : null))
      .filter((domain): domain is string => Boolean(domain));

    let account = null as { id: string; name: string } | null;

    for (const hint of normalizedHints) {
      account = await this.prisma.account.findFirst({
        where: {
          organizationId: input.organizationId,
          OR: [
            { normalizedName: hint.normalized },
            { name: { equals: hint.name, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true },
      });
      if (account) break;
    }

    if (!account && participantDomains.length > 0) {
      account = await this.prisma.account.findFirst({
        where: {
          organizationId: input.organizationId,
          domain: { in: participantDomains },
        },
        select: { id: true, name: true },
      });
    }

    if (!account) {
      const best = normalizedHints[0];
      if (!best) return;
      const domain = participantDomains[0] ?? null;
      account = await this.prisma.account.create({
        data: {
          organizationId: input.organizationId,
          name: best.name,
          normalizedName: best.normalized,
          domain,
        },
        select: { id: true, name: true },
      });
    }

    await this.prisma.call.update({
      where: { id: input.callId },
      data: {
        accountId: account.id,
        matchMethod: "FUZZY_NAME",
        matchConfidence: 0.7,
      },
    });

    for (const participant of input.participants) {
      if (!participant.email) continue;
      const domain = extractEmailDomain(participant.email);
      if (!domain) continue;
      await this.prisma.contact.upsert({
        where: {
          accountId_email: {
            accountId: account.id,
            email: participant.email.toLowerCase(),
          },
        },
        create: {
          accountId: account.id,
          email: participant.email.toLowerCase(),
          emailDomain: domain,
          name: participant.name ?? null,
          title: participant.title ?? null,
        },
        update: {
          name: participant.name ?? undefined,
          title: participant.title ?? undefined,
        },
      });
    }
  }

  // ─── CRM Sync ────────────────────────────────────────────────────────────

  private async syncCRMProvider(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    // Sync accounts first (contacts reference them)
    const accountCount = await this.syncAccounts(config, provider, credentials);
    const contactCount = await this.syncContacts(config, provider, credentials);
    const opportunityCount = await this.syncOpportunities(config, provider, credentials);

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
    return accountCount + contactCount + opportunityCount;
  }

  private async syncAccounts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchAccounts(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      for (const account of result.data) {
        await this.persistAccount(config.organizationId, account);
        total++;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
  }

  private async persistAccount(
    organizationId: string,
    account: NormalizedAccount
  ): Promise<void> {
    const normalized = normalizeCompanyName(account.name);
    const existingByExternal = await this.prisma.account.findFirst({
      where: { organizationId, salesforceId: account.externalId },
    });

    if (!existingByExternal) {
      const potentialConflict = await this.prisma.account.findFirst({
        where: {
          organizationId,
          OR: [
            { normalizedName: normalized },
            ...(account.domain ? [{ domain: account.domain }] : []),
          ],
          salesforceId: { not: account.externalId },
        },
      });

      if (potentialConflict) {
        await this.queueMergeConflictReview({
          organizationId,
          targetType: "account",
          targetId: potentialConflict.id,
          requestPayload: {
            conflict_type: "ACCOUNT_EXTERNAL_ID_COLLISION",
            existing_account_id: potentialConflict.id,
            existing_salesforce_id: potentialConflict.salesforceId,
            incoming_external_id: account.externalId,
            incoming_name: account.name,
            incoming_domain: account.domain,
          },
        });
        return;
      }
    }

    if (existingByExternal) {
      await this.prisma.account.update({
        where: { id: existingByExternal.id },
        data: {
          name: account.name,
          normalizedName: normalized,
          domain: account.domain ?? undefined,
          industry: account.industry ?? undefined,
          employeeCount: account.employeeCount ?? undefined,
          annualRevenue: account.annualRevenue ?? undefined,
        },
      });
      return;
    }

    await this.prisma.account.create({
      data: {
        organizationId,
        name: account.name,
        normalizedName: normalized,
        domain: account.domain,
        salesforceId: account.externalId,
        industry: account.industry,
        employeeCount: account.employeeCount,
        annualRevenue: account.annualRevenue,
      },
    });
  }

  private async syncContacts(
    config: IntegrationConfig,
    provider: CRMDataProvider,
    credentials: ProviderCredentials
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchContacts(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      for (const contact of result.data) {
        await this.persistContact(config.organizationId, contact);
        total++;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
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

    const existingByEmailAcrossOrg = await this.prisma.contact.findFirst({
      where: {
        email: contact.email.toLowerCase(),
        account: { organizationId },
        accountId: { not: account.id },
      },
      select: { id: true, accountId: true, salesforceId: true },
    });
    if (existingByEmailAcrossOrg) {
      await this.queueMergeConflictReview({
        organizationId,
        targetType: "contact",
        targetId: existingByEmailAcrossOrg.id,
        requestPayload: {
          conflict_type: "CONTACT_EMAIL_COLLISION",
          existing_contact_id: existingByEmailAcrossOrg.id,
          existing_account_id: existingByEmailAcrossOrg.accountId,
          incoming_account_id: account.id,
          incoming_external_id: contact.externalId,
          email: contact.email.toLowerCase(),
        },
      });
      return;
    }

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
  ): Promise<number> {
    let cursor: string | null = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const result = await this.withRetry(
        () => provider.fetchOpportunities(credentials, cursor, config.lastSyncAt),
        { attempts: 4, baseDelayMs: 1000 }
      );

      for (const opp of result.data) {
        await this.persistOpportunity(config.organizationId, opp);
        total++;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore && !!cursor;
    }
    return total;
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

    const existingOppElsewhere = await this.prisma.salesforceEvent.findFirst({
      where: {
        opportunityId: opp.externalId,
        account: { organizationId, id: { not: account.id } },
      },
      select: { id: true, accountId: true },
    });
    if (existingOppElsewhere) {
      await this.queueMergeConflictReview({
        organizationId,
        targetType: "opportunity",
        targetId: existingOppElsewhere.id,
        requestPayload: {
          conflict_type: "OPPORTUNITY_ACCOUNT_COLLISION",
          opportunity_id: opp.externalId,
          existing_account_id: existingOppElsewhere.accountId,
          incoming_account_id: account.id,
        },
      });
      return;
    }

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
